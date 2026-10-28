# Contributing to GEO Radar

感谢你愿意参与。GEO Radar 的核心不是页面数量，而是**证据链是否可信**，所以贡献时请优先保证数据口径和可验证性。

## 开始之前

```bash
git clone https://github.com/Leterhong/GEO-Radar.git
cd GEO-Radar
npm ci
cp .env.example .env.local
# 填写 DATABASE_URL / AUTH_SECRET / CREDENTIAL_ENCRYPTION_KEY
npm run dev:db      # 另一个终端保持运行
npm run db:migrate
npm run dev
```

## 开发约定

- 使用 TypeScript strict；不要用 `any` 绕过类型问题。
- 指标必须由服务端确定性代码计算；不要让 LLM 直接生成统计数字。
- 新增/修改指标时，必须同时更新：
  - 分子、分母、样本范围
  - 公式版本
  - 单元测试
  - `docs/geo-analysis.md` 或相关文档
- 失败、空结果、未发现、待复核必须保持为不同状态，不能合并成“未发现”。
- Mock 数据必须显式标记，不能进入真实统计；Mock 报告默认禁止。
- 原始搜索结果 / `RawSearchResponse` 不可被分析层覆盖。
- 不要提交 `.env.local`、API Key、数据库密码、客户数据、未授权截图。
- 数据库变更使用 Prisma migration，不允许直接改生产表结构。

## 提交 PR

1. 从 `main` 拉分支：`feat/...`、`fix/...`、`docs/...`
2. 提交前本地通过：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

3. PR 描述请包含：
   - 解决什么问题
   - 关键实现
   - 如何验证（命令、截图、真实/模拟数据）
   - 是否影响历史数据或指标口径
   - 是否有 UI 变更（附截图）

## Commit 信息

建议使用 Conventional Commits：

```text
feat: add page-level evidence filter
fix: keep failed items out of metric denominator
docs: clarify official coverage notConfigured state
test: cover retry snapshot revision
```

## 报告安全问题

请阅读 [SECURITY.md](SECURITY.md)，不要公开贴 API Key 或可利用细节。
