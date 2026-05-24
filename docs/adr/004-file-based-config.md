# ADR 004: 文件配置 ~/.murmur.json

**状态**: 已采纳 (2026-05-23)

## 上下文

Murmur 的所有设置存储在 SQLite 数据库中，加密字段使用 safeStorage。这对于 GUI 应用是足够的，但不支持：

- 文本编辑器快速修改配置
- 版本控制共享配置
- CLI 模式读取配置
- 自动化脚本配置

## 决策

引入 `~/.murmur.json`（实际路径为 `{userData}/murmur.json`）文件配置：

- `loadFileConfig(path)` — 读取并过滤安全字段
- `saveFileConfig(path, settings)` — 写入白名单字段
- DatabaseManager 的 `getSetting` 方法改为三级优先链：DB > 文件 > 默认值

安全策略：只有白名单内的键（`FILE_CONFIGURABLE_KEYS`）可读写文件配置。`ai_api_key` 等敏感字段始终留在加密数据库中。

## 理由

文件配置是 CLI 模式和 MCP Server 的前置依赖。SQLite 不适合非交互式工具读取。白名单机制确保敏感数据不会意外写入明文文件。

## 影响

- `src/helpers/fileConfig.js` — 新增文件配置模块
- `src/helpers/database.js` — 新增 `setFileConfigPath`，`getSetting` 增加文件回退
- CLI/MCP 可直接读取 JSON 配置
