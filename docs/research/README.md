# Murmur 测试策略研究索引

> 第二版 | 日期：2026-07-25 | 基于 Ralph 完成 57 个新测试后的代码库

## 文档清单

### 第一轮研究（架构 + gap 分析）

| 文档                                                                       | 行数 | 内容                                              |
| -------------------------------------------------------------------------- | ---- | ------------------------------------------------- |
| [comprehensive-test-strategy.md](./comprehensive-test-strategy.md)         | 1029 | 完整测试金字塔设计、Unit/Integration/E2E 用例清单 |
| [murmur-architecture-map.md](./murmur-architecture-map.md)                 | 988  | 7 个子系统架构图、测试 seam、关键路径             |
| [electron-testing-best-practices.md](./electron-testing-best-practices.md) | 530  | Playwright/Electron 官方文档、VS Code 测试架构    |
| [test-coverage-gap-analysis.md](./test-coverage-gap-analysis.md)           | 352  | 逐文件覆盖审计、未测模块/通道/错误路径            |

### 第二轮深度设计（可执行测试用例）

| 文档                                                                 | 行数 | 内容                                         |
| -------------------------------------------------------------------- | ---- | -------------------------------------------- |
| [deep-test-design-v2.md](./deep-test-design-v2.md)                   | 579  | 覆盖率瓶颈精确分析 + P0 修复测试 + 实施计划  |
| [deep-test-design-managers.md](./deep-test-design-managers.md)       | 1689 | 12 个 Manager 的 135 个详细测试用例          |
| [deep-test-design-e2e.md](./deep-test-design-e2e.md)                 | 1366 | 8 个关键用户旅程的完整 Playwright 代码       |
| [deep-test-design-error-paths.md](./deep-test-design-error-paths.md) | 1576 | 7 个子系统的错误路径测试 + 3 个真实 bug 发现 |

**总计：9 份文档，8109 行**

## 核心发现

### 🐛 3 个真实 Bug（错误路径 agent 发现）

1. **database.ts:80 — 加密失败丢数据**: `_encryptValue` 不 catch `encryptString` 异常。OS keyring 锁定时 `setSetting("ai_api_key", ...)` 抛错且设置丢失，无明文 fallback。
2. **audioPathValidator.ts:36 — 符号链接逃逸**: `path.resolve` 不解析 symlink。homedir 内指向 `/etc/passwd.wav` 的 symlink 绕过目录限制。建议改用 `fs.realpathSync`。
3. **transcriptionHandlers.ts:296 — 非空断言崩溃**: `processTextWithAI!` 用 `!` 断言。无 `processTextWithAI` 时 AI_REVIEW 抛 TypeError，被 catch 后返回泛化错误。

### P0 立即可做（零风险）

1. **4 个文件被错误排除覆盖**（零 electron 依赖但被排除）：
   - `funasrServer.ts`、`pythonInstaller.ts`、`environment.ts`、`funasrManager.ts`
   - **修复**：从 `vitest.config.ts` coverage.exclude 删除这 4 行

2. **覆盖率阈值阻塞**（精确到行号）：
   - `fileConfig.ts` 63% branches → loadFileConfig 错误路径（8 tests）
   - `database.ts` 67% branches → segments 解析 + 解密（12 tests）
   - `providerPresets.ts` 33% functions → getProviderByName（2 tests）
   - `ipcRateLimiter.ts` 50% functions → rateLimitedHandler 执行（3 tests）

### 测试用例总量

| 类别            | 新测试数 | 来源                            |
| --------------- | -------- | ------------------------------- |
| P0 覆盖率修复   | 25       | deep-test-design-v2.md          |
| Manager 纯逻辑  | 135      | deep-test-design-managers.md    |
| 错误路径 + 安全 | 58       | deep-test-design-error-paths.md |
| E2E 旅程        | 40       | deep-test-design-e2e.md         |
| **总计**        | **~258** |                                 |

## 实施路线图

1. **P0（立即）**：移除 4 个错误排除 + 覆盖率瓶颈修复（~25 tests）+ 修 3 个 bug
2. **P1（第一周）**：Manager 纯逻辑测试（~135 tests）
3. **P2（第二周）**：E2E Tier 1-2 CI 可靠测试（~25 tests）
4. **P3（第三周）**：错误路径 + E2E Tier 3（~90 tests）
5. **P4（持续）**：测试基础设施改进
