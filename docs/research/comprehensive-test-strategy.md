# Murmur 端到端测试策略：从客户端启动到功能回归

> 状态：草案 | 日期：2026-07-24 | 基于 TS big-bang 迁移后的代码库

## 1. 现状分析

### 1.1 代码库规模

| 维度                  | 数量                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 后端源文件 (.ts)      | 39 (main, preload, 24 helpers, 10 IPC handlers, asrEngine, assertElectronAPI, i18n, process)                         |
| 前端源文件 (.tsx/.ts) | ~30 (React 组件, hooks, settings)                                                                                    |
| IPC 通道定义          | 90                                                                                                                   |
| Preload 暴露方法      | 89                                                                                                                   |
| Manager 类            | 12 (Window, Database, Clipboard, Tray, Hotkey, FunASR, FunASRServer, Model, PythonEnv, PythonInstaller, Update, Log) |

### 1.2 现有测试

| 层级     | 数量                          | 通过率                 |
| -------- | ----------------------------- | ---------------------- |
| 单元测试 | 674 (65 文件)                 | 100%                   |
| E2E 测试 | 39 (11 suites)                | 本地 15/39, CI 0/39    |
| 覆盖率   | 96.83% stmts, 75.19% branches | branches 低于 88% 阈值 |

### 1.3 关键 Gap

**无单元测试的 Manager（5 个）：**

- `clipboard.ts` — 剪贴板读写 + osascript 粘贴
- `hotkeyManager.ts` — 全局快捷键注册/注销
- `tray.ts` — 系统托盘 + 右键菜单
- `pythonEnvironment.ts` — Python 环境检测 + PATH 管理
- `pythonInstaller.ts` — FunASR 包安装

**源码文本断言测试（6 个文件，117 处）：**
这些测试读源文件文本做 `toContain`/`toMatch` 断言，不是行为测试。重构后容易假绿或假红：

- `windows-compat.test.js` (22 处)
- `phase3-semi-auto-update.test.js` (28 处)
- `phase4-i18n.test.js` (21 处)
- `phase5-a11y.test.js` (7 处)
- `updateManager-require-resolution.test.js` (3 处)
- `settings-refactor.test.js` (36 处)

**未测试的 IPC 通道：~62/90**
e2e 只覆盖了 28 个 electronAPI 方法，剩余 62 个通道没有端到端验证。

**E2E 关键旅程缺失（8 个）：**

1. 快捷键 → 录音开始/停止 → 转录结果
2. 文件导入 → 转录 → AI 优化 → 导出
3. 模型下载 → 进度 → 完成
4. 托盘 → 显示/隐藏/退出
5. 应用更新检查
6. FunASR 安装/卸载
7. 多窗口（主 + 历史 + 设置同时）
8. 错误恢复（Python 不可用, AI 不可达）

**E2E CI 问题：**

- macOS CI runner 的 `firstWindow()` 超时（headless 环境限制）
- 需要虚拟显示或 Electron headless 配置

---

## 2. 测试金字塔设计

### 2.1 目标金字塔

```
                    ┌─────────┐
                    │   E2E   │  ~50 tests (关键用户旅程, CI 可靠)
                   ─┤  10%    ├─
                  / └─────────┘ \
                 /                \
               ┌──────────────────┐
               │  Integration     │  ~150 tests (IPC 契约, 模块交互)
               │  30%             │
               └──────────────────┘
              /                     \
            ┌─────────────────────────┐
            │  Unit                   │  ~300 tests (纯逻辑, 快速反馈)
            │  60%                    │
            └─────────────────────────┘
```

### 2.2 分层原则

| 层级        | 目标           | 反馈时间 | 运行环境              | 依赖            |
| ----------- | -------------- | -------- | --------------------- | --------------- |
| Unit        | 纯逻辑正确性   | <2s      | Node (vitest)         | 无外部依赖      |
| Integration | 模块间契约     | <10s     | Node (vitest + mock)  | Mock electron   |
| E2E         | 用户旅程完整性 | <60s     | Electron (Playwright) | 真实 app bundle |

---

## 3. Unit 测试设计（60% — ~300 tests）

### 3.1 需要新增的 Manager 单元测试

#### clipboard.ts（当前 0 tests → 目标 15 tests）

**Seam**: ClipboardManager 类的公共方法

```
测试用例：
1. writeText 调用 electron.clipboard.writeText
2. readText 调用 electron.clipboard.readText
3. pasteText 在 macOS 上调用 osascript（mock spawn）
4. pasteText 在 Windows 上使用 PowerShell（mock spawn）
5. pasteText 在 Linux 上使用 xclip（mock spawn）
6. pasteText 超时后返回失败（3s 超时）
7. pasteText hasTimedOut 防止双重 resolve
8. osascript 加载失败时回退到备用方法
9. osascript 加载失败时记录警告日志
10. safeLog 在 logger 为 null 时不崩溃
11. safeLog 在 logger.info 抛出 EPIPE 时不崩溃
12. pasteWindows 包含 windowsHide: true
13. pasteWindows 包含 setTimeout 3000ms
14. constructor 在非 darwin 平台不加载 osascript
15. constructor 在 darwin 平台加载 osascript
```

**Mock 策略**:

- `vi.mock("electron")` → mock `clipboard` 对象
- `vi.mock("child_process")` → mock `spawn`/`spawnSync`
- `vi.mock("osascript")` → mock 模块加载

#### hotkeyManager.ts（当前 0 tests → 目标 12 tests）

**Seam**: HotkeyManager 类

```
测试用例：
1. register 注册全局快捷键（mock globalShortcut.register）
2. register 返回 false 时记录错误
3. unregister 注销快捷键（mock globalShortcut.unregister）
4. getCurrentHotkey 返回当前快捷键
5. registerF2 注册 F2 快捷键
6. unregisterF2 注销 F2 快捷键
7. setRecordingState 更新录音状态
8. getRecordingState 返回当前状态
9. 快捷键格式 "CommandOrControl+Shift+R" 正确解析
10. 重复注册同一快捷键不报错
11. unregisterAll 注销所有快捷键
12. 快捷键触发时调用回调
```

#### tray.ts（当前 0 tests → 目标 10 tests）

**Seam**: TrayManager 类

```
测试用例：
1. createTray 创建托盘图标（mock Tray, Menu）
2. getTrayIconPath 在 dev 返回项目根路径
3. getTrayIconPath 在 prod 返回 resourcesPath
4. updateContextMenu 构建正确的菜单模板
5. 点击托盘显示主窗口
6. 右键点击弹出上下文菜单
7. 菜单"显示主窗口"点击后调用 mainWindow.show()
8. 菜单"退出"点击后调用 app.quit()
9. setWindows 设置 mainWindow 引用
10. createTray 在错误时记录日志不崩溃
```

#### pythonEnvironment.ts（当前 0 tests → 目标 14 tests）

**Seam**: PythonEnvironment 类

```
测试用例：
1. isPythonVersionSupported 接受 3.8+
2. isPythonVersionSupported 拒绝 3.7 及以下
3. isPythonVersionSupported 拒绝 null/undefined
4. getFunASRServerPath dev 返回项目根路径
5. getFunASRServerPath prod 返回 resourcesPath
6. getEmbeddedPythonPath dev 返回 python/bin 路径
7. getEmbeddedPythonPath prod 返回 resourcesPath
8. setupIsolatedEnvironment 设置 PYTHONHOME
9. setupIsolatedEnvironment 设置 PYTHONPATH
10. buildPythonEnvironment 设置 PYTHONUTF8=1
11. buildPythonEnvironment 在 embedded Python 存在时使用 embedded
12. buildPythonEnvironment 在 embedded Python 不存在时用系统 Python
13. findPythonExecutableWithFallback 查找 .venv/bin/python
14. findPythonExecutableWithFallback 回退到系统 python3
```

#### pythonInstaller.ts（当前 0 tests → 目标 8 tests）

**Seam**: PythonInstaller 类

```
测试用例：
1. checkInstallation 在 pip 已安装时返回 true
2. checkInstallation 在 pip 未安装时返回 false
3. installFunASR 执行正确的 pip install 命令
4. installFunASR 在安装失败时返回错误
5. installFunASR 在超时时终止进程
6. verifyInstallation 检查 funasr 模块可导入
7. getVersion 返回 Python 版本
8. installFunASR 在 Windows 上使用正确的路径分隔符
```

### 3.2 现有测试质量改进

#### 源码文本断言 → 行为测试

**问题**: 6 个文件 117 处 `readFileSync` + `toContain` 断言测试代码结构而非行为。重构后假绿/假红。

**改进策略**:

| 文件                             | 当前                                  | 改进                                                     |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------- |
| windows-compat                   | 读 clipboard.ts 检查 windowsHide      | 测试 pasteWindows 实际行为：spawn 调用参数含 windowsHide |
| phase3-semi-auto-update          | 读 updateManager.ts 检查 require 路径 | 测试 updateManager 实际加载行为                          |
| phase4-i18n                      | 读 locale 文件检查 key 存在           | 测试 i18next.t() 返回非空字符串                          |
| phase5-a11y                      | 读 main.ts 检查 a11y 配置             | 测试 a11y 权限检查实际行为                               |
| updateManager-require-resolution | 读 updateManager.ts 检查 require      | 测试 require 实际能解析                                  |
| settings-refactor                | 读 providerPresets.ts 检查 guide      | 测试 getProviderPresets 返回值                           |

**优先级**: 中（不阻塞合并，但应逐步迁移）

### 3.3 分支覆盖率提升

**当前**: 75.19%（阈值 88%）

**主要 gap**:

- `database.ts`: 67.18% branches — 加密/解密错误路径未测试
- `fileConfig.ts`: 63.63% branches — 配置文件不存在/损坏路径未测试
- `providerPresets.ts`: 50% functions — `getGuideByKey` 未测试
- `ipcRateLimiter.ts`: 50% functions — rate limit 触发后的返回未测试

**改进**: 为每个低覆盖文件添加错误路径测试

---

## 4. Integration 测试设计（30% — ~150 tests）

### 4.1 IPC 契约测试

**目标**: 验证每个 IPC 通道的注册 → 调用 → 响应链完整。

**Seam**: `ipcMain.handle` 注册的 handler，通过 mock ipcMain 测试。

```
测试结构：
1. 加载 ipc/index.ts 的 registerAll
2. Mock ipcMain 记录所有注册的 channel + handler
3. 对每个 channel：
   a. 验证 channel 名称匹配 ipc-contracts.ts 定义
   b. 调用 handler 验证返回值结构
   c. 验证错误处理（无效参数、manager 不可用）
```

**测试文件**: `tests/integration/ipc-contracts.test.ts`

```
describe("IPC contract: every channel is registered and callable", () => {
  // 90 个通道，每个 1-2 个测试 = ~150 tests

  describe("AI channels", () => {
    it("AI.PROCESS registers with correct channel name")
    it("AI.PROCESS handler returns {success, text} or {success:false, error}")
    it("AI.PROCESS rejects empty text")
    it("AI.CHECK_STATUS returns {available, model, latency}")
    it("AI.GET_MODES returns array of mode objects")
    it("AI.GET_PROVIDER_PRESETS returns array with correct shape")
    it("AI.DETECT_LOCAL_MODELS returns {models: []}")
  })

  describe("TRANSCRIPTION channels", () => {
    it("TRANSCRIPTION.SAVE validates input object")
    it("TRANSCRIPTION.SAVE returns numeric id")
    it("TRANSCRIPTION.GET returns record or null")
    it("TRANSCRIPTION.GET_ALL returns array")
    it("TRANSCRIPTION.SEARCH returns filtered results")
    it("TRANSCRIPTION.DELETE returns boolean")
    it("TRANSCRIPTION.EXPORT returns buffer")
    it("TRANSCRIPTION.AI_REVIEW returns optimized text")
  })

  // ... SETTINGS, WINDOW, HOTKEY, CLIPBOARD, UPDATE, SYSTEM, MODELS, FUNASR
})
```

### 4.2 Preload 桥接测试

**目标**: 验证 preload 暴露的每个方法都正确转发到 ipcRenderer。

**Seam**: `contextBridge.exposeInWorld` 的 API surface。

```
describe("Preload bridge: every exposed method maps to correct IPC channel", () => {
  // 89 个方法，每个验证 channel 映射

  it("electronAPI.processText invokes 'process-text' channel")
  it("electronAPI.checkModelFiles invokes 'check-model-files' channel")
  it("electronAPI.saveTranscription invokes 'save-transcription' channel")
  // ...
})
```

**测试文件**: `tests/integration/preload-bridge.test.ts`

### 4.3 Manager 交互测试

**目标**: 验证多个 Manager 协作的场景。

```
describe("Manager integration", () => {
  describe("Database + Settings", () => {
    it("setSetting then getSetting returns same value")
    it("getSetting returns default when key not set")
    it("encrypted ai_api_key round-trips through safeStorage")
  })

  describe("Database + Transcription", () => {
    it("saveTranscription then getTranscription returns same text")
    it("searchTranscriptions finds by text content")
    it("deleteTranscription removes record")
  })

  describe("FunASRServer + ServerMessageRouter", () => {
    it("server stdout message routes to correct handler")
    it("server crash triggers auto-restart")
  })

  describe("ModelManager + DatabaseManager", () => {
    it("model download progress persists to database")
    it("model check reads cached state from database")
  })
})
```

### 4.4 Rate Limiter 集成测试

```
describe("IPC rate limiter integration", () => {
  it("AI.PROCESS limited to 20 calls/minute")
  it("MODELS.DOWNLOAD limited to 3 calls/5minutes")
  it("non-limited channels pass through")
  it("rate limit returns {success:false, error:'Rate limit exceeded'}")
})
```

---

## 5. E2E 测试设计（10% — ~50 tests）

### 5.1 E2E 测试分层

**Tier 1: 启动冒烟（必须通过，CI 可靠）**

```
00-smoke-launch.test.ts
  - app launches and shows main window
  - preload bridge exposes electronAPI
  - app version is valid semver
  - renderer HTML loads without errors
  - CSP headers are set
```

**Tier 2: 核心功能（通过 IPC mock，CI 可靠）**

```
01-settings-ipc.test.ts
  - get/set setting roundtrip
  - AI provider presets available
  - settings export/import roundtrip
  - reset settings

02-history-ipc.test.ts
  - save/get/delete transcription
  - search transcriptions
  - clear all
  - export transcription

03-clipboard-ipc.test.ts
  - copy/paste text
  - paste mode setting
  - pasteText IPC call

04-window-ipc.test.ts
  - minimize/maximize/restore
  - always-on-top toggle
  - open/close history window
  - open/close settings window
```

**Tier 3: 完整旅程（需要 GUI/音频，本地优先）**

```
05-recording-flow.test.ts
  - hotkey → recording start
  - recording stop → transcription result (mock ASR)
  - AI optimization (mock AI)
  - auto-paste to clipboard

06-file-import-flow.test.ts
  - file mode → drop zone visible
  - validate audio file
  - transcribe file (mock)
  - export result

07-model-download-flow.test.ts
  - initial state: need_download
  - download progress events
  - download complete → ready state
  - download failure → error state

08-tray-management.test.ts
  - tray icon visible
  - click tray → show window
  - right-click → context menu
  - quit from tray

09-multi-window.test.ts
  - open main + history + settings simultaneously
  - window focus management
  - close one doesn't close others

10-error-resilience.test.ts
  - Python unavailable → graceful degradation
  - AI unreachable → error message
  - database locked → retry
  - corrupt audio file → error handling

11-update-flow.test.ts
  - check for updates
  - download progress
  - install update (mock)
```

### 5.2 E2E 测试基础设施改进

#### 5.2.1 CI Headless 修复

**问题**: macOS CI `firstWindow()` 超时

**方案**:

```javascript
// electron-launch.js
const app = await electron.launch({
  args: [appRoot, "--disable-gpu", "--no-sandbox"],
  env: {
    ...process.env,
    NODE_ENV: "test",
    MURMUR_DB_PATH: ":memory:",
    // CI 环境标志
    MURMUR_E2E_CI: process.env.CI ? "true" : "false",
    ...env,
  },
});
```

#### 5.2.2 测试 Fixtures

```
tests/fixtures/
  audio/
    sample-1s.wav      # 1秒测试音频
    sample-corrupt.wav  # 损坏音频
    sample-mp3.mp3      # 非 WAV 格式
  settings/
    default.json        # 默认设置
    with-api-key.json   # 含 API key 的设置
```

#### 5.2.3 共享测试助手

```
tests/helpers/
  electron-launch.js    # ✅ 已有
  ipc-mock.js           # ✅ 已有
  global-setup.js       # ✅ 已有
  fixtures.js           # 新增：加载 fixture 文件
  db-helper.js          # 新增：测试数据库操作
  audio-mock.js         # 新增：音频流 mock
  wait-for.js           # 新增：等待条件辅助
```

### 5.3 E2E vs Integration 边界

| 场景             | 层级               | 理由               |
| ---------------- | ------------------ | ------------------ |
| IPC channel 注册 | Integration        | 不需要 GUI         |
| Settings CRUD    | E2E Tier 2         | 需要真实 DB + IPC  |
| 录音流程         | E2E Tier 3         | 需要音频设备       |
| 模型下载         | E2E Tier 3         | 需要网络 + 进度    |
| 窗口管理         | E2E Tier 2         | 需要 BrowserWindow |
| Tray 交互        | E2E Tier 3         | 需要 GUI           |
| AI 调用          | Integration (mock) | 不依赖网络         |
| 数据库加密       | Integration        | 不需要 GUI         |
| Python 子进程    | Unit (mock spawn)  | 不依赖 Python      |

---

## 6. 关键用户旅程测试矩阵

### 6.1 从启动到功能的完整路径

```
用户操作                    测试层级    测试用例
─────────────────────────────────────────────────────────────
1. 双击启动 app             E2E        00-smoke: app launches
2. 主窗口显示               E2E        00-smoke: window visible
3. preload 加载             E2E        00-smoke: electronAPI defined
4. 首次使用引导显示         E2E        00-ftue: onboarding visible
5. 检查模型状态             Integration check-model-files handler
6. 模型未下载 → 显示下载    E2E        02-model: need_download state
7. 下载模型                 E2E        07-model-download: progress
8. 模型就绪 → 麦克风可用    E2E        03-recording: mic enabled
9. 按快捷键开始录音         E2E        05-recording: hotkey start
10. 音频采集                Unit       audio capture mock
11. 发送到 FunASR           Integration server-message-router
12. 接收转录结果            E2E        05-recording: transcription result
13. AI 优化文本             Integration ai-handlers: processText
14. 自动粘贴到剪贴板        E2E        06-clipboard: pasteText
15. 保存转录记录            Integration db: saveTranscription
16. 历史记录可查            E2E        08-history: getTranscriptions
17. 导出转录                E2E        08-history: exportTranscription
18. 打开设置                E2E        09-window: open settings
19. 配置 AI provider        E2E        07-settings: set AI config
20. 测试 AI 连接            Integration ai: checkAIStatus
21. 最小化到托盘            E2E        08-tray: minimize to tray
22. 托盘点击恢复            E2E        08-tray: restore from tray
23. 退出应用                E2E        00-smoke: quit gracefully
```

### 6.2 错误恢复路径

```
错误场景                    测试层级    预期行为
─────────────────────────────────────────────────────────────
Python 未安装               E2E        显示降级提示, 基本功能可用
FunASR 服务器崩溃           Unit       自动重启, 最多 3 次
AI API 不可达               Integration 返回错误, 不崩溃
API key 无效                Integration 返回 401 错误
数据库锁定                   Integration 等待重试
磁盘空间不足                 E2E        下载失败, 显示错误
音频文件损坏                 E2E        转录失败, 显示错误
网络断开                     E2E        AI 调用失败, 保留原文
快捷键冲突                   Unit       注册失败, 记录警告
```

---

## 7. CI 策略

### 7.1 CI 流水线

```yaml
# .github/workflows/ci.yml
jobs:
  lint-and-test:
    steps:
      - build:main # 编译 main bundle
      - build:preload # 编译 preload bundle
      - format:check
      - lint
      - typecheck
      - test:coverage # 单元测试 + 覆盖率
      - build:renderer # 编译前端

  e2e:
    needs: lint-and-test
    runs-on: macos-latest
    steps:
      - build:main
      - build:preload
      - build:renderer
      - test:e2e:smoke # Tier 1: 冒烟测试（必须通过）
      - test:e2e:ipc # Tier 2: IPC 测试（必须通过）
      - test:e2e:full # Tier 3: 完整旅程（continue-on-error）
```

### 7.2 测试脚本

```json
{
  "test:unit": "vitest run",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "test:e2e:smoke": "playwright test --grep @smoke",
  "test:e2e:ipc": "playwright test --grep @ipc",
  "test:e2e:full": "playwright test",
  "test:fast": "npm run test:unit && npm run test:integration",
  "test:ci": "npm run test:fast && npm run test:e2e:smoke && npm run test:e2e:ipc"
}
```

### 7.3 覆盖率目标

| 指标       | 当前   | 目标 | 阈值 |
| ---------- | ------ | ---- | ---- |
| Statements | 96.83% | 97%  | 95%  |
| Branches   | 75.19% | 88%  | 85%  |
| Functions  | 94.54% | 96%  | 95%  |
| Lines      | 96.95% | 97%  | 95%  |

---

## 8. 实施优先级

### P0 — 阻塞合并（立即）

1. 修复 E2E CI headless 问题（firstWindow 超时）
2. 确保 `npm start` 能启动打包后的 app（build:main 在 prestart）

### P1 — 迁移后第一周

1. 5 个无测试 Manager 的单元测试（clipboard, hotkey, tray, pythonEnv, pythonInstaller）
2. IPC 契约测试（90 通道注册验证）
3. E2E Tier 1 冒烟测试（CI 可靠）

### P2 — 迁移后第二周

1. Preload 桥接测试（89 方法映射验证）
2. E2E Tier 2 IPC 测试（settings, history, clipboard, window）
3. 分支覆盖率提升（database, fileConfig, providerPresets）

### P3 — 迁移后第三周

1. E2E Tier 3 完整旅程（录音, 文件导入, 模型下载, 托盘）
2. 源码文本断言迁移为行为测试（6 文件 117 处）
3. 错误恢复路径测试

### P4 — 持续改进

1. 性能测试（启动时间, IPC 延迟）
2. 多平台测试（macOS arm64, Windows, Linux）
3. 可视化回归测试（截图对比）

---

## 9. 业界最佳实践参考

### 9.1 Playwright Electron 官方模式

来源：[Playwright Electron API 文档](https://playwright.dev/docs/api/class-electron)

**启动模式**:

```javascript
const { _electron: electron } = require('@playwright/test');
const app = await electron.launch({
  args: ['.'],                    // 传项目根，让 Electron 读 package.json "main"
  timeout: 30000,                 // 启动超时
  env: { NODE_ENV: 'test', ... }, // 环境变量
  cwd: process.cwd(),             // 工作目录
});
const window = await app.firstWindow();
```

**主进程 evaluate**:

```javascript
// 在主进程上下文执行代码，可访问 electron 模块
const appPath = await app.evaluate(async ({ app }) => app.getAppPath());

// mock 原生对话框（Playwright 无法拦截原生 OS API）
await app.evaluate(
  ({ dialog }, filePaths) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths });
  },
  ["/path/to/file.txt"],
);
```

**关键限制**:

- Playwright **无法拦截原生 Electron 对话框**（dialog.showOpenDialog 等），因为它们走 OS API
- 解决方案：用 `app.evaluate()` 在主进程中替换这些方法
- 替换持续到应用关闭

**启动超时排查**:

- 如果 `firstWindow()` 超时，检查 `FuseV1Options.EnableNodeCliInspectArguments` 是否被设为 false
- 确保入口文件正确（我们的案例：`package.json "main"` = `dist-main/main.js`）

### 9.2 Electron 官方测试指南

来源：[Electron Automated Testing 教程](https://www.electronjs.org/docs/latest/tutorial/automated-testing)

**推荐框架**:

1. **Playwright**（首选）— `@playwright/test`，Chrome DevTools Protocol
2. **WebdriverIO** — WebDriver 协议，可自动发现打包后的二进制
3. **Custom Test Driver** — 自定义 IPC-over-STDIO，最低开销但需额外代码

**主进程 vs 渲染进程测试**:

- Electron 官方推荐**端到端**方式（启动整个 app），而非隔离进程
- 主进程：通过 `app.evaluate()` 访问 electron API
- 渲染进程：通过 `Page` 对象操作 DOM

**环境变量模式**:

```javascript
// 让主进程知道处于测试模式
env: { APP_TEST_DRIVER: '1', NODE_ENV: 'test' }
```

**开发模式执行**:

- Playwright 测试应传 `args: ['.']`（开发模式），指向主进程入口

### 9.3 VS Code 测试架构

来源：VS Code GitHub 仓库测试结构分析

**分层**:

1. **Unit tests** — 纯逻辑，无 electron 依赖
2. **Platform tests** — mock electron API 的集成测试
3. **Integration tests** — 真实 electron 环境，但 mock 外部服务
4. **E2E tests** — 完整用户场景

**关键实践**:

- 自定义测试运行器（非 vitest/jest）
- 每层有独立的测试配置和超时
- Electron API mock 在 `platform` 层统一管理
- IPC 测试在 `integration` 层，验证主↔渲染通信

### 9.4 vitest Electron Mocking 模式

**模式 1: vi.mock("electron")**

```typescript
// 适用于：manager 单元测试
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/test"), getAppPath: vi.fn(() => "/fake") },
  BrowserWindow: vi.fn(),
  clipboard: { writeText: vi.fn(), readText: vi.fn() },
  globalShortcut: { register: vi.fn(), unregister: vi.fn() },
}));
```

**限制**: `vi.mock` 只拦截 ESM `import`，不拦截 CJS `require()`。如果源文件用 `require("electron")`，需要用 `Module._resolveFilename` monkey-patch（参见我们的 `windowManager-events.test.js`）。

**模式 2: Module.\_resolveFilename monkey-patch**

```javascript
// 适用于：CJS 源文件 + 需要 mock electron 的场景
const requireCJS = createRequire(import.meta.url);
const Module = requireCJS("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "electron") return "electron-stub";
  return origResolve.call(this, request, ...rest);
};
requireCJS.cache["electron-stub"] = { exports: electronStub };
```

**模式 3: app.evaluate() in E2E**

```javascript
// 适用于：E2E 测试中 mock 原生 API
await app.evaluate(({ ipcMain }) => {
  ipcMain.removeHandler("check-model-files");
  ipcMain.handle("check-model-files", () => ({ isReady: true }));
});
```

### 9.5 IPC 契约测试模式

**业界做法**: 不逐个测 IPC channel（太多），而是测**契约不变性**:

1. **Channel 注册完整性**: `registerAll` 后所有 `ipc-contracts` 定义的 channel 都有 handler
2. **返回值结构一致性**: 每个 handler 返回 `{ success: boolean, ... }` 或抛异常
3. **参数验证**: handler 拒绝无效参数
4. **Rate limiting**: 高频通道有限流

```typescript
describe("IPC contract completeness", () => {
  it("every channel in ipc-contracts has a registered handler", () => {
    // 加载 registerAll，mock ipcMain 记录注册
    const registered = new Set();
    const mockIpcMain = {
      handle: (channel, handler) => registered.add(channel),
    };
    registerAll(mockIpcMain, mockManagers);

    // 验证所有定义的 channel 都注册了
    for (const [group, channels] of Object.entries(C)) {
      for (const [key, value] of Object.entries(channels)) {
        expect(registered).toContain(value);
      }
    }
  });
});
```

### 9.6 Preload 桥接测试模式

**业界做法**: 验证 preload 暴露的 API surface 与 IPC channel 一一对应:

```typescript
describe("Preload bridge completeness", () => {
  it("every IPC channel has a corresponding electronAPI method", () => {
    // 加载 preload bundle，在 jsdom 环境
    const api = window.electronAPI;

    // 从 ipc-contracts 提取所有 invoke 通道
    const channels = Object.values(C).flatMap((group) => Object.values(group));

    // 验证每个通道有对应的 API 方法
    for (const channel of channels) {
      // channel "process-text" → method "processText"
      const methodName = camelCase(channel);
      expect(typeof api[methodName]).toBe("function");
    }
  });
});
```

### 9.7 测试金字塔比例参考

| 来源                | Unit    | Integration | E2E     |
| ------------------- | ------- | ----------- | ------- |
| Google Testing Blog | 70%     | 20%         | 10%     |
| VS Code (估)        | 60%     | 25%         | 15%     |
| Playwright 官方建议 | 60%     | 30%         | 10%     |
| **Murmur 目标**     | **60%** | **30%**     | **10%** |

### 9.8 CI Headless Electron 最佳实践

**问题**: macOS CI runner 上 Electron `firstWindow()` 超时

**业界方案**:

1. **Linux + xvfb**: 在 Linux CI 上用 `xvfb-run` 运行虚拟显示
2. **macOS virtual display**: macOS 不支持 xvfb，但可以用 `--disable-gpu` + `--no-sandbox`
3. **Electron headless 实验性**: Electron 36+ 支持 `app.commandLine.appendSwitch('headless')`
4. **分离冒烟测试**: 只在 CI 跑最关键的启动测试，完整 e2e 在本地或 nightly CI

**推荐**:

```yaml
# CI 只跑 Tier 1 (smoke) + Tier 2 (IPC mock)
# Tier 3 (full journey) 在 nightly 或手动触发
e2e-ci:
  runs-on: macos-latest
  steps:
    - run: pnpm test:e2e --grep "@smoke|@ipc"
      continue-on-error: false # 必须通过

e2e-nightly:
  runs-on: macos-latest
  schedule: [{ cron: "0 2 * * *" }]
  steps:
    - run: pnpm test:e2e # 全部 e2e
      continue-on-error: true
```

---

## 10. 测试文件组织

```
tests/
├── unit/                           # 单元测试（现有 65 文件 → ~80）
│   ├── managers/                   # 新增：Manager 单元测试
│   │   ├── clipboard.test.ts
│   │   ├── hotkeyManager.test.ts
│   │   ├── tray.test.ts
│   │   ├── pythonEnvironment.test.ts
│   │   └── pythonInstaller.test.ts
│   ├── ... (现有文件)
│   └── backend-type-safety.test.ts # 类型安全守护
│
├── integration/                    # 新增：集成测试
│   ├── ipc-contracts.test.ts       # IPC 通道契约
│   ├── preload-bridge.test.ts      # Preload 桥接
│   ├── database-integration.test.ts # DB + Settings
│   ├── funasr-integration.test.ts  # Server + Router
│   └── rate-limiter.test.ts        # 限流集成
│
├── e2e/                            # E2E 测试（现有 11 → ~15 suites）
│   ├── suites/
│   │   ├── 00-smoke-launch.test.ts # Tier 1（重写为可靠冒烟）
│   │   ├── 01-settings-ipc.test.ts # Tier 2
│   │   ├── 02-history-ipc.test.ts  # Tier 2
│   │   ├── 03-clipboard-ipc.test.ts# Tier 2
│   │   ├── 04-window-ipc.test.ts   # Tier 2
│   │   ├── 05-recording-flow.test.ts # Tier 3
│   │   ├── 06-file-import-flow.test.ts # Tier 3
│   │   ├── 07-model-download.test.ts # Tier 3
│   │   ├── 08-tray-management.test.ts # Tier 3
│   │   ├── 09-multi-window.test.ts # Tier 3
│   │   ├── 10-error-resilience.test.ts # Tier 3
│   │   └── 11-update-flow.test.ts # Tier 3
│   ├── helpers/
│   │   ├── electron-launch.js      # ✅ 已有
│   │   ├── ipc-mock.js             # ✅ 已有
│   │   ├── global-setup.js         # ✅ 已有
│   │   ├── fixtures.js             # 新增
│   │   ├── db-helper.js            # 新增
│   │   └── audio-mock.js           # 新增
│   └── fixtures/
│       ├── audio/
│       └── settings/
│
├── _tsresolve.setup.js             # ✅ .ts 解析 monkey-patch
└── vitest.config.js                # ✅ 已有
```

---

## 附录 A：测试用例完整清单

> 以下是需要新增的测试用例完整清单，按优先级排序。

### P1: Manager 单元测试（59 tests）

#### clipboard.ts (15 tests)

1. writeText 调用 electron.clipboard.writeText
2. readText 调用 electron.clipboard.readText
3. pasteText macOS 调用 osascript
4. pasteText Windows 使用 PowerShell
5. pasteText Linux 使用 xclip
6. pasteText 超时返回失败
7. pasteText hasTimedOut 防双 resolve
8. osascript 加载失败回退
9. osascript 加载失败记录警告
10. safeLog logger null 不崩溃
11. safeLog EPIPE 不崩溃
12. pasteWindows windowsHide: true
13. pasteWindows setTimeout 3000ms
14. constructor 非 darwin 不加载 osascript
15. constructor darwin 加载 osascript

#### hotkeyManager.ts (12 tests)

1. register 注册快捷键
2. register 失败记录错误
3. unregister 注销快捷键
4. getCurrentHotkey 返回值
5. registerF2 注册 F2
6. unregisterF2 注销 F2
7. setRecordingState 更新状态
8. getRecordingState 返回状态
9. 快捷键格式解析
10. 重复注册不报错
11. unregisterAll 注销全部
12. 快捷键触发回调

#### tray.ts (10 tests)

1. createTray 创建托盘
2. getTrayIconPath dev 路径
3. getTrayIconPath prod 路径
4. updateContextMenu 菜单模板
5. 点击托盘显示窗口
6. 右键弹出菜单
7. 菜单"显示主窗口"行为
8. 菜单"退出"行为
9. setWindows 设置引用
10. createTray 错误不崩溃

#### pythonEnvironment.ts (14 tests)

1. isPythonVersionSupported 3.8+
2. isPythonVersionSupported <3.8
3. isPythonVersionSupported null
4. getFunASRServerPath dev
5. getFunASRServerPath prod
6. getEmbeddedPythonPath dev
7. getEmbeddedPythonPath prod
8. setupIsolatedEnvironment PYTHONHOME
9. setupIsolatedEnvironment PYTHONPATH
10. buildPythonEnvironment PYTHONUTF8
11. buildPythonEnvironment embedded 存在
12. buildPythonEnvironment embedded 不存在
13. findPythonExecutable .venv
14. findPythonExecutable 系统 python3

#### pythonInstaller.ts (8 tests)

1. checkInstallation pip 已安装
2. checkInstallation pip 未安装
3. installFunASR pip install 命令
4. installFunASR 安装失败
5. installFunASR 超时
6. verifyInstallation funasr 可导入
7. getVersion Python 版本
8. installFunASR Windows 路径分隔符

### P1: IPC 契约测试（90 tests）

每个 IPC 通道 1 个注册验证测试：

```
AI (5): PROCESS, CHECK_STATUS, GET_MODES, GET_PROVIDER_PRESETS, DETECT_LOCAL_MODELS
TRANSCRIPTION (13): AUDIO, IMPORT_FILE, VALIDATE_FILE, TRANSCRIBE_FILE, CANCEL, SAVE, GET, GET_ALL, DELETE, SEARCH, STATS, CLEAR, EXPORT, EXPORT_ALL, AI_REVIEW, DIARIZE
SETTINGS (8): GET, SET, GET_ALL, GET_LEGACY, SAVE, RESET, IMPORT, EXPORT
WINDOW (16): HIDE, SHOW, MINIMIZE, MAXIMIZE, IS_MAX, CLOSE, SET_TOP, CLOSE_APP, RELOAD, OPEN_DEV_TOOLS, OPEN_HISTORY, CLOSE_HISTORY, HIDE_HISTORY, OPEN_SETTINGS, CLOSE_SETTINGS, HIDE_SETTINGS
HOTKEY (7): REGISTER, UNREGISTER, GET_CURRENT, REGISTER_F2, UNREGISTER_F2, SET_STATE, GET_STATE
CLIPBOARD (4): PASTE, COPY, READ, WRITE
UPDATE (4): CHECK, DOWNLOAD, CANCEL, INSTALL
SYSTEM (9): INFO, DEBUG_INFO, PERMISSIONS, REQUEST_PERMS, TEST_A11Y, OPEN_PERMS, VERSION, LOG, OPEN_EXTERNAL
MODELS (7): CHECK, DOWNLOAD, PROGRESS, DOWNLOAD_MODEL, AVAILABLE, CURRENT, SWITCH
FUNASR (3): INSTALL, STATUS, RESTART
EVENTS (14): TOGGLE_DICTATION, HOTKEY_TRIGGERED, F2_DOUBLE_CLICK, WINDOW_MAXIMIZE_CHANGE, TRANSCRIPTION_UPDATE, PROCESSING_UPDATE, ERROR, SETTINGS_UPDATE, MODEL_DOWNLOAD_PROGRESS, FILE_TRANSCRIPTION_PROGRESS, FUNASR_INSTALL_PROGRESS, UPDATE_DOWNLOAD_PROGRESS, UPDATE_DOWNLOAD_COMPLETE, UPDATE_DOWNLOAD_ERROR
```

### P2: Preload 桥接测试（89 tests）

每个 preload 暴露的方法 1 个 channel 映射验证。

### P2: E2E Tier 1-2（~25 tests）

Tier 1 冒烟（5 tests）+ Tier 2 IPC（~20 tests）

### P3: E2E Tier 3（~25 tests）

完整用户旅程测试。

**总计新增：~290 tests**

- Unit: 59 (Manager) + 现有改进
- Integration: 90 (IPC) + 89 (Preload) + 15 (Manager 交互) = ~194
- E2E: ~50 (Tier 1-3)
