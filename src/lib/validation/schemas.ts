import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确").max(200),
  password: z
    .string()
    .min(8, "密码至少 8 位")
    .max(72, "密码过长")
    .regex(/[a-zA-Z]/, "密码需包含字母")
    .regex(/[0-9]/, "密码需包含数字"),
  name: z.string().trim().min(1, "请填写用户名").max(50),
  agreeTerms: z.literal(true, { errorMap: () => ({ message: "请先阅读并同意用户协议与隐私政策" }) }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  password: z.string().min(1, "请输入密码"),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1, "工作空间名称不能为空").max(60),
});

export const brandSchema = z.object({
  name: z.string().trim().min(1, "品牌名称不能为空").max(100),
  englishName: z.string().trim().max(100).optional().or(z.literal("")),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  websiteUrl: z.string().trim().max(300).optional().or(z.literal("")),
  industry: z.string().trim().max(60).optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  keywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  officialSubdomains: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  products: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  productAliases: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
});

export const competitorSchema = z.object({
  brandId: z.string().min(1, "请选择关联品牌"),
  name: z.string().trim().min(1, "竞品名称不能为空").max(100),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  websiteUrl: z.string().trim().max(300).optional().or(z.literal("")),
  industry: z.string().trim().max(60).optional().or(z.literal("")),
  products: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  productAliases: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  enabled: z.boolean().optional(),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export const questionSetSchema = z.object({
  name: z.string().trim().min(1, "问题集名称不能为空").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const questionSchema = z.object({
  questionSetId: z.string().min(1, "请选择问题集"),
  text: z.string().trim().min(1, "问题内容不能为空").max(300),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  intent: z.string().trim().max(60).optional().or(z.literal("")),
  region: z.string().trim().max(60).optional().or(z.literal("")),
  language: z.string().trim().max(30).optional().or(z.literal("")),
  priority: z.number().int().min(1).max(5).optional(),
  enabled: z.boolean().optional(),
});

export const credentialSaveSchema = z.object({
  apiKey: z.string().trim().min(8, "API Key 长度不符合预期").max(300),
});

export const searchTaskCreateSchema = z.object({
  name: z.string().trim().min(1, "请填写任务名称").max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  brandId: z.string().optional().or(z.literal("")),
  questionSetId: z.string().optional().or(z.literal("")),
  questionIds: z.array(z.string()).max(100).optional(),
  executionMode: z.enum(["REAL", "MOCK"]),
  maxResults: z.number().int().optional(),
  mode: z.number().int().optional(),
  industry: z.enum(["gov", "news", "acad", "finance"]).optional(),
  freshness: z.string().max(30).optional(),
  site: z.string().max(500).optional(),
  deeplinks: z.boolean().optional(),
});

export const evidenceReviewSchema = z.object({
  mentionStatus: z.enum(["PENDING_REVIEW", "CONFIRMED_BRAND", "CONFIRMED_COMPETITOR", "IRRELEVANT", "AMBIGUOUS"]),
  reviewNote: z.string().trim().max(500).optional().or(z.literal("")),
});

export const optimizationTaskSchema = z.object({
  title: z.string().trim().min(1, "请填写任务标题").max(150),
  description: z.string().trim().min(1, "请填写任务描述").max(3000),
  type: z.string().trim().min(1).max(60),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  brandId: z.string().optional().or(z.literal("")),
  status: z.enum(["OPEN", "IN_PROGRESS", "NEEDS_VERIFICATION", "DONE", "DISMISSED"]).optional(),
  assignee: z.string().trim().max(60).optional().or(z.literal("")),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

export const optimizationTaskUpdateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "NEEDS_VERIFICATION", "DONE", "DISMISSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  title: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().min(1).max(3000).optional(),
  assignee: z.string().trim().max(60).optional().or(z.literal("")),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});
