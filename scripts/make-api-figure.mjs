/** 用真实数据生成"API 请求与返回"图（内容来自数据库中的真实原始响应，密钥已隐藏） */
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
const ids = JSON.parse(readFileSync("docs/case-study-ids.json", "utf8"));

const raw = await prisma.rawSearchResponse.findFirst({
  where: { taskId: ids.taskId },
  orderBy: { createdAt: "asc" },
});
if (!raw) throw new Error("未找到原始响应快照");

let parsed = null;
try {
  parsed = JSON.parse(raw.body);
} catch {
  parsed = null;
}
const response = parsed?.Response ?? {};
const pages = Array.isArray(response.Pages) ? response.Pages : [];
const firstPage = pages.length > 0 ? JSON.parse(pages[0]) : null;
const preview = {
  Response: {
    Query: response.Query,
    RequestId: response.RequestId,
    Version: response.Version,
    Msg: response.Msg ?? "",
    Pages: [
      JSON.stringify(
        {
          title: firstPage?.title,
          url: firstPage?.url,
          date: firstPage?.date,
          site: firstPage?.site,
          passage: (firstPage?.passage ?? "").slice(0, 90) + "…",
          score: firstPage?.score,
        },
        null,
        2
      ).replace(/\n/g, ""),
      `… 其余 ${pages.length - 1} 条同类结构`,
    ],
  },
};

const escape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<style>
  body { margin:0; background:#F7F9FC; font-family:'Microsoft YaHei',system-ui,sans-serif; color:#172033; }
  .wrap { width:1180px; padding:28px 32px; box-sizing:border-box; }
  h1 { font-size:19px; margin:0 0 4px; }
  .sub { font-size:12px; color:#667085; margin-bottom:18px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .card { background:#fff; border:1px solid #E6EAF0; border-radius:12px; overflow:hidden; }
  .head { display:flex; align-items:center; gap:8px; padding:9px 14px; background:#F8FAFD; border-bottom:1px solid #E6EAF0; font-size:12px; color:#344054; }
  .dot { width:8px; height:8px; border-radius:50%; }
  pre { margin:0; padding:14px 16px; font-family:Consolas,'Courier New',monospace; font-size:11.5px; line-height:1.62; white-space:pre-wrap; word-break:break-all; }
  .k { color:#315FC7; } .s { color:#16845B; } .n { color:#B7791F; }
  .meta { margin-top:14px; display:flex; gap:10px; flex-wrap:wrap; }
  .chip { font-size:11.5px; padding:3px 9px; border-radius:6px; background:#EDF4FF; color:#315FC7; }
  .note { margin-top:12px; font-size:11px; color:#98A2B3; }
</style></head><body><div class="wrap">
  <h1>元宝 SearchPro 真实请求与返回（节选）</h1>
  <div class="sub">服务 API Key 方式 · 仅服务端调用 · Authorization 已隐藏 · 内容来自本次实测的原始响应快照</div>
  <div class="grid">
    <div class="card">
      <div class="head"><span class="dot" style="background:#4677E8"></span>POST 请求</div>
      <pre><span class="k">POST</span> https://api.wsa.cloud.tencent.com/SearchPro
<span class="k">Authorization:</span> Bearer sk-f****…7cc6   <span class="n">（真实密钥已隐藏）</span>
<span class="k">Content-Type:</span> application/json; charset=UTF-8

{
  <span class="s">"Query"</span>: <span class="s">"${escape(response.Query ?? "国内有哪些好用的 AI 搜索助手？")}"</span>
}</pre>
    </div>
    <div class="card">
      <div class="head"><span class="dot" style="background:#37B99A"></span>HTTP 200 响应（Pages 为字符串数组，逐条解析）</div>
      <pre>${escape(JSON.stringify(preview, null, 2))}</pre>
    </div>
  </div>
  <div class="meta">
    <span class="chip">HTTP 200</span>
    <span class="chip">RequestId ${escape(response.RequestId ?? "")}</span>
    <span class="chip">Version ${escape(response.Version ?? "")}</span>
    <span class="chip">Pages ${pages.length} 条</span>
  </div>
  <div class="note">注意：业务错误（如 UnauthorizedOperation）同样以 HTTP 200 返回，错误信息位于 Response.Error，必须单独判断。</div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 560 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(200);
await page.screenshot({ path: "docs/assets/api-call.png", fullPage: true });
await browser.close();
console.log("saved docs/assets/api-call.png");
console.log("real requestId:", response.RequestId, "version:", response.Version, "pages:", pages.length);
await prisma.$disconnect();
