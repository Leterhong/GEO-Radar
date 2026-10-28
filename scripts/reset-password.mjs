/**
 * 本地/自托管环境的密码重置工具（当前版本无邮件服务，因此不提供网页自助重置）。
 * 用法：node scripts/reset-password.mjs <email> <newPassword>
 * 直接更新数据库中的 bcrypt 哈希，并吊销该用户的全部会话。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) {
  console.error("用法: node scripts/reset-password.mjs <email> <newPassword>");
  process.exit(1);
}
if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
  console.error("密码至少 8 位，且需包含字母和数字。");
  process.exit(1);
}

const prisma = new PrismaClient();
const normalizedEmail = email.trim().toLowerCase();

const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
if (!user) {
  console.error(`未找到邮箱为 ${normalizedEmail} 的账号。`);
  await prisma.$disconnect();
  process.exit(1);
}

const passwordHash = await bcrypt.hash(newPassword, 12);
await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
const revoked = await prisma.session.deleteMany({ where: { userId: user.id } });
console.log(`已重置密码：${normalizedEmail}（已吊销 ${revoked.count} 个会话，请重新登录）`);
await prisma.$disconnect();
