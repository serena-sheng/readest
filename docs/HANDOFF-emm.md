# HANDOFF — Common Reader 风格的本地阅读器

> 新会话先读这份，再读 `docs/specs/` 最新一篇与 `docs/EVIDENCE.md`。

## 现在是什么状态

两套东西并行，边界清楚：

| 仓库 | 角色 | 关键提交 |
|---|---|---|
| `~/dev/readest`（AGPL fork） | **产品外壳**：解锁、主题、阅读页、翻译器、问书面板 | `bc2ee09` 解锁 · `aab96ed` emm 翻译器 · `e89177a`/`8985f06`/`6afaa2d` 视觉迁移 · `591dcb3` 中和纹理 · `5fb9ab3` 空白页/页眉 · `8cf6c1e` 卡片作用域 · `e06f0eb` Word Lens 悬停 |
| `~/dev/commonreader-ai`（自有） | **库与 AI 层**：入库、标签、翻译专家、问书、本地服务 `:8790` | `1887400` 入库 · `f8e9275` 标签表达式 · `35cc08b` 想法 · `4357166` 问书 · 最新 `307e1a4` 账本 |
| Obsidian `HTML和MD/CommonReader风格原型-2026-10-18.html` | **设计真源**：视觉与交互的参照，不再作为产品外壳 | 由 `:8790` 托管 |

## 跑起来

```bash
# 1) 本地服务（库 + AI + 原型）
cd ~/dev/commonreader-ai && python3 -u server.py        # :8790

# 2) 外壳
cd ~/dev/readest && npx -y pnpm@11.1.1 --filter readest-app tauri dev
```

- 主题：设置 → 主题 → 颜色 → **Emm**（新装默认已是 emm；旧装需切一次，或直接改
  `~/Library/WebKit/Readest/WebsiteData/Default/<hash>/LocalStorage/localstorage.sqlite3`
  里的 `themeColor` / `libraryThemeColor`）
- 翻译：设置 → 语言 → 翻译器选「本地专家（本机服务）」；风格用
  `localStorage['emm.translationStyle']`（如 `humanities.faithful` / `jp_light.learn`）
- 问书：阅读页工具栏「问书」按钮

## 已决事项

| # | 决定 | 记录 |
|---|---|---|
| 1 | 外壳 = fork Readest（Tauri） | `commonreader-ai/docs/adr/0001` |
| 2 | 站点导入 = 只解析已下载的元数据与文件，不做抓取 | 同上 |
| 3 | 本地构建视为 lifetime：所有付费门禁放行、会员 UI 隐藏 | `readest` commit `bc2ee09` |
| 4 | 云只用 iCloud（Readest 自带 provider，未改） | 同上 |

## 已知缺口

1. **书架真导入未跑通验证**：`GET /library/books`、`GET /library/file` 与
   `services/librarySource.ts` + 「From Local Library」菜单都在，但没在真机上导入过一本。
2. **问书面板的选区捕获**：依赖打开面板瞬间 iframe 里的 `getSelection()`，未在真实 foliate
   上验证。
3. **iCloud 同步未实配**：解锁后可配置，但没连过。
4. **生产构建未打**：`tauri build` 会去掉左下角的 Next dev overlay（「1 Issue」）。
5. **e-ink 下侧栏**：`backdrop-filter` 无效，会退化为半透明纯色，可补
   `:not([data-eink='true'])`。
6. **封面取色氛围**：只有一本纯文字封面时看不出效果，需要带插画的封面验证。

## 下一步（按价值排序）

1. **书架真导入**：点「From Local Library」，导入 3 本，确认书库出现、能打开、进度独立。
2. **问书真问一句**：确认 SSE 流式在面板里渲染。
3. **iCloud**：设置 → 集成 → iCloud，选一个文件夹，确认两端进度同步。
4. **打一次生产包**：`npx tauri build`，确认 dev overlay 消失、主题与翻译仍在。
