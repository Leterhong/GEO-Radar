# SearchPro acceptance matrix

Date: 2026-10-30  
Scope: 10 representative categories. This is **not** all-industry/all-query
coverage.

## Matrix

| Category | Query | MOCK | REAL |
|---|---|---|---|
| brand | 腾讯元宝 | PASS | 待授权 |
| official | 腾讯元宝 官网 | PASS | 待授权 |
| product | 腾讯元宝 SearchPro 产品 | PASS | 待授权 |
| service | 腾讯元宝 AI 搜索 服务 | PASS | 待授权 |
| competitor | 豆包 Kimi AI 搜索 对比 | PASS | 待授权 |
| industry | AI 搜索 行业 趋势 | PASS | 待授权 |
| long_tail | 腾讯元宝 适合企业内容监测吗 | PASS | 待授权 |
| chinese | 中文 AI 搜索 品牌 可见度 | PASS | 待授权 |
| english | Tencent Yuanbao AI search | PASS | 待授权 |
| no_result | zzzxqv-never-indexed-georadar-2026 | PASS（MOCK 固定数据，不能证明真实无结果） | 待授权 |

## MOCK result

```text
taskId: cmvux54kl002v10ik7kakajbl
status: COMPLETED
total: 10
completed: 10
failed: 0
empty: 0
```

MOCK results are deterministic test data. They verify task creation, question
snapshots, execution, evidence storage and the toolchain; they do **not** prove
SearchPro search quality or a no-result response.

## Input validation

Covered by unit tests:

- empty query rejected
- query > 200 chars rejected
- Cnt only 10/20/30/40/50
- special characters preserved and trimmed
- Chinese/English query preserved
- missing response fields remain undefined (provider tests)
- timeout / HTTP / provider error paths (provider tests)

## Real execution

Real matrix is **not authorized in this round**. `scripts/searchpro-matrix.mjs
--real` requires:

```powershell
$env:CONFIRM_REAL_SEARCH="1"
$env:GEO_RADAR_TOKEN="gr_..."
$env:SEARCHPRO_BRAND_ID="cmvrogw69000bmrhmnt55fgem"
npm run searchpro:matrix -- --real
```

This performs 10 real requests and may consume SearchPro quota. Do not run it
without approval.
