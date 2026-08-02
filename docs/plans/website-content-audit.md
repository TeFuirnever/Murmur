# Website 内容审计与改进计划

> **状态：** `pending approval`（ralplan 共识规划）
> **日期：** 2026-08-02

## 审计结论：Website 内容与项目实际状态存在 12 处差距

---

## 🔴 内容准确性问题（必须修复）

### 1. AI 提供商数量错误 — 说"10+"实际是 11

**现状：** Website 的 `AIModels.astro` 列出 10 个提供商，文案写 "10+ AI Models"。
**实际：** `providerPresets.ts` 有 **11 个**。**OpenRouter** 完全缺失。

**修复：** 添加 OpenRouter 到 AIModels 组件，文案改为 "11+ AI Models"（对比表、Hero、FeatureGrid 同步）。

### 2. 平台支持描述误导

**现状：** 结构化数据 `operatingSystem: "macOS, Windows, Linux"`。FAQ 没提平台限制。
**实际：** GitHub Releases 只有 **macOS arm64**（DMG + ZIP）和 **Windows**（EXE）。无 x64 macOS，无 Linux。

**修复：** 结构化数据改为 `"macOS, Windows"`。FAQ 新增"支持哪些平台？"条目。Download 按钮区分 macOS/Windows。

### 3. FAQ 不完整 — 只有 6 条，实际有 8 条

**缺失：**
- "需要安装 ffmpeg 吗？"（答：v1.0.0 起通常不需要，仅 mp3/m4a 回退时需要）
- "麦克风权限怎么开？"（macOS/Windows 路径）

**修复：** 新增 2 条 FAQ，i18n 双语。

### 4. 版本号不显示

**现状：** Website 无任何版本信息。
**实际：** 最新 v1.2.0（2026-08-02 发布）。

**修复：** Footer 或 Hero 区域显示 "v1.2.0"，链接到 CHANGELOG。

---

## 🟡 内容缺失（业界最佳实践）

### 5. 无截图/演示

**现状：** 纯文字+图标，无产品截图。
**业界标准：** Linear、Raycast、Arc Browser 都有大幅产品截图/GIF。

**建议：** 截取 1-2 张产品截图（狐狸新图标界面），放到 Hero 下方。GIF 更佳但工作量大，可作为后续迭代。

### 6. 无安全特性展示

**现状：** Website 完全没提安全措施。
**SECURITY.md 有：** CSP、contextIsolation、safeStorage 加密、SSRF 防护、本地处理。

**建议：** FeatureGrid 或 "Why Murmur" 区域新增安全卡片："端到端本地处理 + API Key 系统钥匙串加密 + CSP 沙箱隔离"。

### 7. 无路线图

**现状：** 无 roadmap 展示。
**README 有完整路线图：** 已完成 12 项 + 规划中 5 项（实时流式转录、CLI 模式等）。

**建议：** 新增 Roadmap 区域，展示"已完成"和"开发中"分栏，让用户看到项目活跃度。

### 8. 无社交证明

**现状：** 无 star 数、无下载量、无用户评价。
**业界标准：** 开源项目 landing page 通常显示 GitHub stars badge。

**建议：** Hero 或 Header 区域添加 GitHub stars badge（shields.io 静态图片）。

---

## 🟢 技术问题

### 9. Header 品牌文字用了"Download"

**现状：** `Header.astro:13` 左上角 logo 文字是 `t.nav_download`（"Download"/"下载"）。
**问题：** 用户点击左上角期望回到首页，看到"下载"会困惑。

**修复：** 改为品牌名 "Murmur"。

### 10. 死代码 i18n key

`footer_description`、`comparison_dimension`、`nav_github` 三个 key 存在但无组件引用。清理或启用。

### 11. Footer 年份硬编码

**现状：** `© 2024–{year}` — "2024" 是硬编码。项目 2026 年创建。

**修复：** 改为 `© {year}` 或 `© 2026–{year}`。

### 12. 404 页面未使用 i18n

**现状：** 404 页面标题、描述、按钮文字全部硬编码。
**修复：** 抽取到 i18n 文件。

---

## 实施方案

### Phase 1 — 数据准确性修复（优先）

| # | 改动 | 文件 |
|---|------|------|
| 1 | 添加 OpenRouter，"10+"→"11+" | `AIModels.astro`, `en.json`, `zh.json` |
| 2 | 平台描述修正 | `Layout.astro`（structured data）, 新增 FAQ |
| 3 | 补全 FAQ（ffmpeg + 麦克风权限） | `FAQ.astro`, `en.json`, `zh.json` |
| 4 | 版本号显示 | `Footer.astro` 或 `Hero.astro` |
| 9 | Header 品牌文字 → "Murmur" | `Header.astro`, `en.json`, `zh.json` |
| 11 | Footer 年份修正 | `Footer.astro` |

### Phase 2 — 内容增强（建议）

| # | 改动 | 文件 |
|---|------|------|
| 5 | 截图/演示区 | 新增 `Screenshot.astro` 组件 |
| 6 | 安全特性卡片 | `FeatureGrid.astro` 或新区域 |
| 7 | 路线图区域 | 新增 `Roadmap.astro` 组件 |
| 8 | GitHub stars badge | `Header.astro` 或 `Hero.astro` |

### Phase 3 — 清理（可选）

| # | 改动 | 文件 |
|---|------|------|
| 10 | 删除死 key | `en.json`, `zh.json` |
| 12 | 404 i18n 化 | `404.astro`, `zh/404.astro`, i18n |

---

## RALPLAN-DR Summary

**Principles:**
1. 数据准确优先 — Website 必须反映项目真实状态
2. 最小改动 — 只改内容，不改设计系统/布局架构
3. 双语同步 — 所有新增内容必须有 EN + ZH

**Decision Drivers:**
1. OpenRouter 缺失是事实错误，必须修
2. 平台支持误导会带来用户投诉，必须修
3. 截图/路线图是转化率提升，优先级低于数据修复

**Options:**
- **A（推荐）：** Phase 1 立即执行（数据修复），Phase 2-3 后续迭代
- **B：** 一次性全做（Phase 1+2+3），但截图需要额外工作
