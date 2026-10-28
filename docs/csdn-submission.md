# 元宝搜索开发者征文大赛 · 提交说明

## 文章标题（必须带前缀）

```text
【元宝搜索开发者征文大赛】从真实搜索结果出发：我用元宝搜索构建了一个 GEO 品牌可见性诊断平台
```

对应文章：[docs/article-geo-radar.md](article-geo-radar.md)

## 作品阶段

**可演示原型**：已真实调用元宝搜索 SearchPro 完成两轮复测，每轮 10 个问题、10/10 成功；已生成两轮对比报告和证据报告。

## 参赛视频

[GEO-Radar-元宝搜索实战演示-1440p.mp4](https://github.com/Leterhong/GEO-Radar/releases/download/v0.1.0/GEO-Radar-yuanbao-demo-1440p.mp4)

- 时长：7 分 57 秒
- 画质：2560×1440
- 内容：元宝搜索 SearchPro 接入 → 设置连接 → 品牌/问题配置 → 真实采集 → 页面级证据 → 问题矩阵 → 快照 → 两轮比较 → 报告 → 平台完整性 → 架构
- 字幕：[georadar-yuanbao-tour.srt](assets/video/georadar-yuanbao-tour.srt)
- 封面：[hero.jpg](assets/readme/hero.jpg)

## 视频里的真实数据

- 元宝搜索 SearchPro，`YUANBAO` 数据源
- 第二轮真实复测：10 个问题，10/10 成功，98 条结果
- 单请求耗时：81–385ms（本次样本）
- 品牌提及问题率：6/10 = 60%
- 官网结果覆盖率：0/10 = 0%
- 第三方页面覆盖率：6/10 = 60%
- 竞品：豆包 70%，Kimi 70%
- 两轮对比：品牌状态 100% 一致，观测极差 0（仅两轮，不宣称稳定分布）
- 报告：10/10 成功，60% / 0% / 60%

## 文章内视频位置

建议放在 **6.3 指标之后、6.4 之前**。文章里已经留了视频说明段落；上传视频号后把卡片插在 6.3 末尾即可。

## 仓库 / Skill / MCP / DSH 链接位置

**不要把四个链接全堆在开头。** 开头只放一个“代码 + 演示”入口，读者先看冲突和结果；等讲完架构/数据分层后，再放 Agent 三件套。

推荐结构：

1. **开头导语后（只放仓库 + 视频）**

```text
代码与完整演示：
https://github.com/Leterhong/GEO-Radar
```

2. **第 5 章“关键设计”之后（放 Skill / MCP / DSH）**

```text
给 Agent 用：
- Skill：https://github.com/Leterhong/GEO-Radar/tree/main/skills/geo-radar
- MCP：https://github.com/Leterhong/GEO-Radar/tree/main/packages/geo-radar-mcp
- DSH 插件：https://github.com/Leterhong/GEO-Radar/tree/main/packages/dsh-geo-radar
- 接入文档：https://github.com/Leterhong/GEO-Radar/blob/main/docs/agent-integration.md
```

3. **文末/附录（统一资源区）**

```text
GitHub：https://github.com/Leterhong/GEO-Radar
Live Demo：https://leterhong.github.io/GEO-Radar/
演示视频：https://github.com/Leterhong/GEO-Radar/releases/tag/v0.1.0
Skill：https://github.com/Leterhong/GEO-Radar/tree/main/skills/geo-radar
MCP：https://github.com/Leterhong/GEO-Radar/tree/main/packages/geo-radar-mcp
DSH：https://github.com/Leterhong/GEO-Radar/tree/main/packages/dsh-geo-radar
```

一句话理由：开头是“为什么值得读”，中段是“怎么实现”，结尾才是“去哪里拿”。四个链接一起放开头，会像广告，也会打断读者进入真实数据的节奏。

## 提交前检查

- [ ] CSDN 标题以 `【元宝搜索开发者征文大赛】` 开头
- [ ] 正文 ≥ 1500 字（不含代码）
- [ ] 包含真实运行截图和来源/时间
- [ ] 标注作品阶段：可演示原型
- [ ] 视频链接或视频号卡片可访问
- [ ] 不泄露 API Key、客户信息或未授权数据
- [ ] 在活动报名表提交文章链接
