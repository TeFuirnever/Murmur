# ADR 002: 自定义 Prompt 模板系统

**状态**: 已采纳 (2026-05-23)

## 上下文

Murmur 内置 6 种 AI 润色模式（optimize, optimize_long, format, correct, summarize, enhance），硬编码在 `aiPrompts.js` 中。用户无法自定义 AI 处理风格或创建适合自己场景的模板。

## 决策

引入基于 Markdown 文件的模板系统：

- 模板文件存放在 `{userData}/templates/` 目录
- 使用 YAML frontmatter 定义元数据（name, label, user_template）
- 文件正文作为 system prompt
- `{text}` 占位符用于用户文本替换

接口设计：

- `parseTemplateFile(content, fileName)` — 解析单个模板文件
- `loadCustomTemplates(templatesDir)` — 从目录加载所有模板
- `buildPrompt(mode, text, { customTemplates })` — 扩展为支持自定义模板

优先级：自定义模板 > 内置模式。用户可以覆盖内置模式。

## 理由

Markdown + YAML frontmatter 是最轻量的模板格式，不需要额外依赖。用户可以用任何文本编辑器创建模板，不需要理解代码。文件系统即配置——不需要 UI 来管理模板。

## 影响

> [20260725_Autopilot_T1.5] 文件名已迁移到 `.ts`（ADR-010 big-bang），下文保留原始决策时（.js 时代）的文件名作为历史记录。

- `src/helpers/aiPrompts.js`（现为 `aiPrompts.ts`）— 新增 `parseTemplateFile` 和 `loadCustomTemplates`
- `src/helpers/ipc/aiHandlers.js`（现为 `aiHandlers.ts`）— `processTextWithAI` 加载自定义模板，新增 `getAIModes` IPC
- `preload.js`（现为 `preload.ts`）— 暴露 `getAIModes` API
