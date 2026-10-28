# GEO Radar — 设计系统（浅色主题）

> 全站默认浅色：Light SaaS + Soft Gradient + Clean Workspace + Modern AI Product。
> 唯一实现：`src/app/globals.css`（CSS 变量）+ `tailwind.config.ts`（语义映射）。
> 组件只允许使用语义类（`bg-card` / `text-tertiary` / `border-border` 等），不得硬编码颜色值。

## 1. 颜色 Token

| 用途 | 变量 | 值 |
| --- | --- | --- |
| 页面背景 | `--background` | `#F7F9FC` |
| 卡片 / 弹窗 / 输入框 | `--card` `--popover` | `#FFFFFF` |
| 次级面 | `--surface-subtle` `--surface-muted` | `#F8FAFD` / `#F1F5F9` |
| 品牌主色 | `--primary` / `--primary-strong` / `--primary-soft` | `#4677E8` / `#315FC7` / `#EDF4FF` |
| 边框 | `--border` / `--border-strong` | `#E6EAF0` / `#D5E2FA` |
| 文字 | `--text-primary`…`--text-disabled` | `#172033` / `#344054` / `#667085` / `#98A2B3` / `#B7BFCC` |
| 状态 | `--success` / `--warning` / `--destructive` / `--info` | `#16845B` / `#B7791F` / `#D64545` / `#356AE6` |
| 状态浅底 | `--success-soft` / `--warning-soft` / `--info-soft` | `#E8F8F2` / `#FFF8E8` / `#EDF4FF` |
| 图表 | `--chart-1`…`--chart-5` | 蓝 / 薄荷 / 淡紫 / 暖黄 / 浅青 |

Tailwind 语义：`background` `foreground` `card` `popover` `primary` `secondary` `muted` `accent`
`destructive` `success` `warning` `info` `surface.subtle` `surface.muted` `border-strong`
`primary.soft` `primary.strong` `success.soft` `warning.soft` `info.soft` `brand.{blue,deep,mint,violet,cyan,sand}` `chart.{1..5}`。

可选的深色变量保留在 `.dark` 下，但默认不启用（`<html>` 不带 `dark` 类）。

## 2. 渐变

只有四种，按用途使用，总面积控制在可视区域的 5%–15%：

| 类 | 定义 | 用途 |
| --- | --- | --- |
| `bg-gradient-a` | `#E8F1FF → #F5F9FF → #FFFFFF` | 登录/注册左栏、对话欢迎页、上手引导 |
| `bg-gradient-b` | `#E9F0FF → #F0ECFF` | 注册页品牌区、AI 功能引导 |
| `bg-gradient-c` | `#E4F7FB → #E6F8F1` | 成功状态、完成提示 |
| `bg-gradient-d` | `#FFFAEF → #FFF2E2` | 帮助与说明性提示 |

禁止：整页渐变、每张卡片不同渐变、高饱和彩虹/霓虹光晕。

## 3. 排版与间距

| 层级 | 规格 |
| --- | --- |
| 页面标题 | 26px / semibold / tracking-tight |
| 区块标题 | 15px / semibold |
| 正文 | 13–14px，行高 1.6 |
| 辅助说明 | 11–12px，`text-quaternary` / `text-tertiary` |
| 表格正文 | 13px，表头 12px `text-tertiary`，表头底色 `surface-subtle` |

圆角：卡片 12px（`rounded-xl`）、弹窗 16px（`rounded-2xl`）、输入/按钮 8–10px。
阴影：默认无阴影，仅浮层使用 `shadow-float`；卡片靠边框与留白分层。

## 4. 组件规范

- **Button**：`default`（品牌蓝）/ `outline`（白底细边框）/ `ghost`（透明+hover 浅灰）/ `soft`（浅蓝底）/ `destructive`。
- **Input / Textarea / Select**：白底、`border-input`、聚焦 `border-primary/60` + 3px 浅蓝 ring。
- **Card**：白底 + `border-border` + `rounded-xl`，无默认阴影。
- **Badge**：浅底 + 同色文字（success / warning / destructive / muted / info / secondary）。
- **Dialog / AlertDialog**：白色主体、`rounded-2xl`、`shadow-float`、遮罩 `#172033/25` + 2px 背景模糊。
- **Table**：表头浅灰底、行 hover `primary-soft/35`、分隔线 `border-border`。
- **Tabs**：容器 `surface-muted`，选中项白底 + 品牌蓝文字。
- **Toast**：sonner `theme="light"`，右下角，避免遮挡导航。
- **Markdown**：正文继承浅色文字，行内代码浅灰底 + 主色文字，代码块 `surface-subtle`。
- **空状态**：`EmptyState`（虚线边框 + 浅底）+ 真实引导操作；关键空页面叠加 `SetupGuide`。

## 5. 布局

- 侧边栏：236px 白色，三组（工作区 / GEO 工作台 / 系统设置），分组标题 10px 大写灰色，选中项 `primary-soft` + 主色图标。
- 顶栏：56px，`bg-card/85` + 背景模糊 + 细边框；左侧工作空间切换，中间状态胶囊（搜索 / 模型），右侧大屏与用户菜单。
- 移动端：侧边栏转为左侧抽屉，表格横向滚动，页面内边距收窄。
- 内容宽度：普通页面 `max-w-6xl`，设置页 `max-w-4xl`，对话正文 `max-w-3xl`。

## 6. 动效

- 仅使用 150–180ms 的颜色/透明度/位移过渡与 `animate-fade-in`。
- 尊重 `prefers-reduced-motion`（已全局关闭动画）。
- 不为装饰添加循环动画、发光或漂浮效果。

## 7. 图表

白色画布、`#EAEFF6` 虚线网格（仅横向）、`#98A2B3` 轴文字、无轴线、Tooltip 白底细边框 + 轻阴影。
数据色使用 `--chart-*`；空数据时显示 `EmptyState`，绝不生成虚构曲线。
