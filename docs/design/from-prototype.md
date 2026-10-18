# 原型到 Readest：迁移设计说明

本文件记录 Web 原型与 Readest fork 之间的设计迁移关系，避免后续实现各自「凭感觉」重做视觉。

## 设计真源

- 原型文件：`/Users/serena/Library/Mobile Documents/com~apple~CloudDocs/Serena-heart/HTML和MD/CommonReader风格原型-2026-10-18.html`
- 状态：**唯一视觉真源**。原型的 CSS 变量、间距、字体栈、动效曲线在出现分歧时以原型为准；Readest 现有主题只作为「可落地」的技术约束。
- 原型本身不随仓库发布（位于 iCloud 个人目录），因此本文件把关键的视觉语言与数值固化下来。原型失效时，以本文件的数值为准。

## 视觉语言要点（6 条）

### 1. 浮动图标栏（`rail`）

- 左侧悬浮胶囊：`left: 14px`，垂直居中，宽 64px，圆角 22px。
- 半透明 + 毛玻璃：`color-mix(card 82%, transparent)` + `backdrop-filter: blur(18px)`，投影用 `--shadow-sm`。
- 条目 44×38，圆角 12px；选中态是**实心绿底白图标**，hover 是浅绿底 + 绿图标；分隔线 22×1、`--line`。
- 底部固定「同步异常」图标（琥珀色）与头像，之间用 `flex: 1` 撑开。
- 落点：`apps/readest-app/src/app/reader/components/`（需要一个独立的 rail 组件，由 `Reader.tsx` 挂载；现有 `SidebarToggler.tsx` 只负责开合侧边栏，不承载这排图标），毛玻璃与阴影变量落在 `apps/readest-app/src/styles/globals.css`。

### 2. 白纸卡双栏（`paper` + `spread`）

- 正文区是一张**白纸卡**：`inset: 34px 30px 30px 96px`，圆角 16px，背景 `--card`，`--shadow`（0 18px 50px / 0 2px 8px 双层）。
- 卡内是双栏网格：`grid-template-columns: 1fr 1fr; gap: 56px`，`column-rule: 1px solid transparent`（分隔线故意留空，靠留白分栏）。
- 正文：15.5px / 行高 1.92 / `text-align: justify`，首段首字下沉 `2.6em`，颜色 `--green-deep`。
- 译文块：无衬线 13px / 1.75，左侧 2px 浅绿竖线，紧贴原文段落下沿（`margin: -.4em 0 1.15em`），注释缩到 11.5px。
- 页码/进度：居中 11px，字距 `.06em`，上下留 8/14px。
- 落点：`apps/readest-app/src/app/reader/components/FoliateViewer.tsx`、`ReaderContent.tsx`（分栏与纸卡容器），列数与间距暴露到 `footerbar/FontLayoutPanel.tsx` 的排版面板；纸卡圆角/阴影令牌进 `apps/readest-app/src/styles/themes.ts` 或 `globals.css`。

### 3. 运行页眉（`runhead`）

- 位于纸卡顶部：左右各一个「章名」，`padding: 26px 56px 0`。
- 10.5px、全大写（中文即原样）、字距 `.14em`、颜色 `--ink-3`——是环境信息，不争夺注意力。
- 落点：`apps/readest-app/src/app/reader/components/HeaderBar.tsx`（结构位置）、`SectionInfo.tsx` / `StatusInfo.tsx`（章节与位置数据来源）。

### 4. 单强调绿

- 全站只有一个强调色：亮色 `#305F4B`，深色 `#7FB79C`；深色正文里的强调用 `--green-deep` `#1B3A2A` / `#A9D3BF`。
- 浅色底用 `rgba(48,95,75,.12)`（`--green-soft`）做 hover/选中底。
- 红色只用于「排除/错误」（`rgba(200,60,60,.12)` + `#A03B3B`），琥珀色只用于同步异常。
- 落点：`apps/readest-app/src/styles/themes.ts`（`themeVariables` / `generateLightPalette` / `generateDarkPalette`）、`daisyui-themes.ts`。

### 5. 宋体标题

- 衬线栈：`"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", "Times New Roman", serif`；无衬线栈：`-apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue"`。
- 界面标题用衬线：34px / 600 / 字距 `.02em`；卡片书名 13px / 500 / 行高 1.45；正文块标题 26px / 600，`--green-deep`。
- 工具类、正文译文、按钮一律用无衬线，避免「全书都是衬线」的糊感。
- 落点：`apps/readest-app/src/styles/fonts.ts`（字体栈）、`themes.ts`（标题/正文 token）、正文注入样式随 `ReaderContent.tsx` 一起下发。

### 6. 封面取色氛围

- 阅读首页背景由当前聚焦书的封面色推导：`--ambient: radial-gradient(120% 90% at 50% 8%, shade(c,+26), shade(c,-34) 52%, shade(c,-52) 100%)`。
- `shade(hex, amt)` 只做 RGB 三通道平移并夹在 0–255，无 HSL 转换；叠加 `rgba(255,255,255,.16)` 的顶部高光层。
- 进入首页才挂 `.ambient`，其余视图回落 `--canvas`；氛围态下 rail/标题/ghost 按钮统一切白或半透明白。
- 落点：`apps/readest-app/src/components/BookCover.tsx`（封面主色来源）、`app/reader/components/BooksGrid.tsx`（首页网格）、`styles/globals.css`（`--ambient` 与 `.ambient` 下的文字反色规则）。

## 迁移状态

| # | 视觉语言 | 落点 | 状态 |
|---|----------|------|------|
| 1 | 浮动图标栏 | `app/reader/components/*` + `styles/globals.css` | 尚未迁移 |
| 2 | 白纸卡双栏 | `FoliateViewer.tsx`、`ReaderContent.tsx`、`footerbar/FontLayoutPanel.tsx` | 尚未迁移 |
| 3 | 运行页眉 | `HeaderBar.tsx`、`SectionInfo.tsx` | 尚未迁移 |
| 4 | 单强调绿 | `styles/themes.ts`、`daisyui-themes.ts` | 尚未迁移 |
| 5 | 宋体标题 | `styles/fonts.ts`、`themes.ts`、`ReaderContent.tsx` | 尚未迁移 |
| 6 | 封面取色氛围 | `components/BookCover.tsx`、`BooksGrid.tsx`、`globals.css` | 尚未迁移 |

**以上 6 条全部尚未迁移到 Readest。** 本仓目前只迁移了原型的翻译链路：`src/services/translators/providers/emm.ts` 对接原型同一套本机 `/translate` 服务（`style` 取 `<题材>.<模式>`），视觉层保持 Readest 原样。

## 迁移时的约束

- 顺序：先做 4、5（令牌层），再做 1、3（结构层），最后做 2、6（阅读页与首页氛围）。令牌先行可以避免每个组件各自写死颜色和字体。
- 深色模式必须同步：原型每个变量都有 `prefers-color-scheme: dark` 覆写，Readest 侧走 `themes.ts` 的 light/dark 两套 palette，不要只改亮色。
- 动效：原型里 rail hover `.18s`、卡片位移 `.25s`、抽屉 `.34s cubic-bezier(.22,1,.36,1)`；实现时只用 `transform`/`opacity`，并遵守 `prefers-reduced-motion`。
- 双栏只在足够宽的视口启用（原型窗宽 1080px 起）；窄屏回落单栏，规则放在阅读设置而非 CSS 媒体查询里，才能和 Readest 已有的分页逻辑一致。
