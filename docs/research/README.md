# Murmur 测试策略研究索引

> 日期：2026-07-24 | 基于 TS big-bang 迁移后的代码库

## 文档清单

| 文档                                                                       | 行数 | 内容                                                                               |
| -------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| [comprehensive-test-strategy.md](./comprehensive-test-strategy.md)         | 1029 | 完整端到端测试策略：金字塔设计、Unit/Integration/E2E 用例清单、CI 策略、实施优先级 |
| [murmur-architecture-map.md](./murmur-architecture-map.md)                 | 910  | Murmur 完整架构图：7 个子系统的公共接口、测试 seam、测试挑战、关键路径             |
| [electron-testing-best-practices.md](./electron-testing-best-practices.md) | 484  | 业界最佳实践：Playwright/Electron 官方文档、VS Code 测试架构、vitest mocking 模式  |
| [test-coverage-gap-analysis.md](./test-coverage-gap-analysis.md)           | 333  | 逐文件测试覆盖审计：未测模块、未测 IPC 通道、未测错误路径、覆盖率瓶颈              |

## 核心发现汇总

### 当前状态

- **674 单元测试** (65 文件, 100% 通过, ~1.9s)
- **39 E2E 测试** (11 suites, 本地 15/39 通过, CI 0/39 — firstWindow 超时)
- **覆盖率**: 96.83% stmts, 75.19% branches (低于 88% 阈值)
- **coverage 排除**: 12 个 manager (~3800 行业务逻辑) + 整个 ipc/ 目录

### 最严重的 Gap

1. **E2E 在 CI 上完全失败** — 0/39 通过，firstWindow 30s 超时。零用户旅程被验证。
2. **3 个 IPC handler 文件零测试** — transcriptionHandlers (16 通道), hotkeyHandlers (7), clipboardHandlers (4)
3. **5 个 Manager 零行为测试** — clipboard, hotkeyManager, tray, pythonEnvironment, pythonInstaller
4. **preload 桥接无真正测试** — 只有源码文本 regex，不执行 contextBridge
5. **117 处源码文本断言** — 6 个文件的测试读源码做 toContain，迁移后假绿风险
6. **updateManager 安全关键逻辑未测** — SHA256 验证、路径逃逸守卫只有源码文本测试

### 架构关键发现

- **UpdateManager 不用 electron-updater** — 手写 GitHub releases 更新器，含自定义 SHA256 验证
- **asrEngine 是未使用的抽象** — 定义了可插拔 ASR 引擎接口，但无 FunASR 实现，未接入 main.ts
- **tests/\_tsresolve.setup.js 是关键基础设施** — 3 部分 monkey-patch 让 .js 测试的 require() 能加载 .ts
- **Manager 用 lazy require("electron")** — 在 try/catch 内延迟加载，保持可单元测试

### 实施优先级

| 优先级   | 任务                                                      | 预计测试数      |
| -------- | --------------------------------------------------------- | --------------- |
| P0       | 修复 E2E CI headless (disableHardwareAcceleration / xvfb) | 0 (修复)        |
| P0       | 确保 npm start 可启动 (build:main 在 prestart)            | 0 (已修复)      |
| P1       | transcriptionHandlers 单元测试                            | ~20             |
| P1       | 5 个无测试 Manager 单元测试                               | ~59             |
| P1       | IPC 契约测试 (90 通道注册验证)                            | ~90             |
| P1       | E2E Tier 1 冒烟测试 (CI 可靠)                             | ~5              |
| P2       | Preload 桥接测试 (89 方法映射)                            | ~89             |
| P2       | hotkeyHandlers + clipboardHandlers 测试                   | ~15             |
| P2       | updateManager 行为测试 (SHA256, 路径守卫)                 | ~10             |
| P2       | 分支覆盖率提升 (database, fileConfig)                     | ~15             |
| P3       | E2E Tier 2 IPC 测试                                       | ~20             |
| P3       | E2E Tier 3 完整旅程                                       | ~25             |
| P3       | 源码文本断言 → 行为测试迁移                               | ~50 (重写)      |
| P4       | 错误恢复路径测试                                          | ~15             |
| P4       | 共享测试基础设施 (mock 工厂, DB helper)                   | 0 (基建)        |
| **总计** |                                                           | **~413 新测试** |

### 业界最佳实践要点

- **测试金字塔**: 60% unit / 30% integration / 10% e2e (Playwright 官方建议)
- **IPC 契约测试**: Murmur 已有 ipc-contracts.ts 作为单一真相源，建议加 preload 桥接单元测试
- **CI E2E 修复**: `app.disableHardwareAcceleration()` 在 test 模式，或迁移到 Linux + xvfb
- **VS Code 模式**: 分 test/unit/ + test/integration/electron/ + test/smoke/ + test/automation/
- **源码文本测试**: 是迁移后的最大假绿风险，应优先转为行为测试

## 建议的下一步

1. **立即**: 修复 E2E CI（`app.disableHardwareAcceleration()` 或 Linux xvfb）
2. **第一周**: P1 任务 — 最高风险的未测逻辑（transcriptionHandlers + 5 Manager + IPC 契约）
3. **第二周**: P2 任务 — 覆盖率阈值达标 + preload 桥接 + 安全关键路径
4. **第三周**: P3 任务 — E2E 完整旅程 + 源码文本测试迁移
5. **持续**: P4 — 错误恢复 + 测试基础设施改进
