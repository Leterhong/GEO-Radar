# Security Policy

## 不要提交的内容

- `.env.local`、`.env`、任何真实 API Key
- 数据库连接串、密码、`CREDENTIAL_ENCRYPTION_KEY`
- 客户品牌数据、未授权的搜索截图、个人信息
- 可复现的凭据、Token、Cookie

## 报告漏洞

如果你发现安全问题，请不要开公开 issue。请通过仓库维护者的 GitHub 联系方式私下报告，并包含：

- 影响范围
- 复现步骤
- 是否需要特定配置
- 建议修复方向

请勿在报告中附带真实 Key；用 `sk-***` 或测试凭据替代。

## 安全设计

- 搜索/模型 API Key 使用 AES-256-GCM 加密存储，前端只返回掩码
- API 路由统一 `withAuth`，数据按 `workspaceId` 隔离
- 认证 Cookie 按请求协议设置 `Secure`；HTTP 局域网不会强制 Secure
- 原始响应与分析层分离，人工复核不覆盖原始数据
- 速率限制当前为进程内内存；多实例部署需替换为 Redis 等共享存储

## 支持范围

当前为 prototype，安全修复优先于新功能。请同时说明你使用的版本/commit。
