# ADR 013: Platform Helper — 平台兼容代码收敛模块

**状态**: 已采纳 (2026-06-07)

**上下文**: [ADR 003 ASR 引擎抽象](003-asr-engine-abstraction.md) | [ADR 012 已知限制](012-known-limitations-tradeoffs.md)

---

## 上下文

Murmur 当前在 **10+ 个文件**中散布了约 **800 行** `process.platform === "darwin" / "win32" / "linux"` 平台条件判断。具体分布：

| 关注点                                         | 文件                                | 行数 | 影响                   |
| ---------------------------------------------- | ----------------------------------- | ---- | ---------------------- |
| 剪贴板粘贴（osascript / PowerShell / xdotool） | `clipboard.js`                      | ~200 | 3 套完全不同的实现     |
| Python 安装（brew+pkg / exe / apt+yum+pacman） | `pythonInstaller.js`                | ~280 | 3 套完全不同的安装流程 |
| macOS 辅助功能 & 系统设置                      | `clipboard.js`, `systemHandlers.js` | ~120 | macOS 独有             |
| 进程树杀死（taskkill vs SIGKILL）              | `funasrServer.js`                   | ~15  | 关键路径               |
| 文件系统路径（AppData / Library / .config）    | `environment.js`                    | ~30  | 散落                   |
| PATH 配置（平台特定目录）                      | `main.js`                           | ~80  | 重复逻辑               |
| FFmpeg 检测（`where` vs `which`）              | `audioFileHelpers.js`               | ~5   | 单行                   |
| 路径分隔符（`;` vs `:`）                       | `pythonEnvironment.js`              | ~5   | 重复常量               |
| 托盘图标（macOS template image）               | `tray.js`                           | ~5   | 单次检查               |
| 更新安装包扩展名（`.dmg` / `.exe`）            | `updateManager.js`                  | ~5   | 单次检查               |

### 问题

1. **认知负载高**：理解 Murmur 在某平台的行为需要追踪 10+ 文件中的 `process.platform` 分支
2. **测试困难**：大部分平台相关模块被排除在覆盖率之外（`vitest.config.js` 排除列表有 12 个文件）
3. **扩展脆弱**：添加 Linux 支持或修改某平台行为需要同时改动多个文件
4. **模式重复**：路径分隔符检测、FFmpeg 检测等在多处重复出现

---

## 决策

### 方案选择过程

最初考虑了完整的 **Adapter 模式**（`platformInterface.js` + `basePlatform.js` + `darwinPlatform.js` + `win32Platform.js` + `linuxPlatform.js` + `index.js` factory），经过对抗性 Review 后否决，原因：

| Adapter 方案的问题                                                                | 严重度   |
| --------------------------------------------------------------------------------- | -------- |
| 800 行旧代码引入 1500+ 行新基础设施，膨胀比 2:1                                   | CRITICAL |
| `PlatformAdapter` 包含 paste/kill/install/paths 所有方法，违反接口隔离原则（ISP） | CRITICAL |
| `basePlatform` 继承结构在 JS 中脆弱，组合优于继承                                 | HIGH     |
| Electron 已提供 `app.getPath('userData')` 等跨平台抽象，重复造轮子                | HIGH     |
| `process.platform` 在 Vitest 中不可靠地 mock，需要传入 override 参数              | HIGH     |

### 最终决策：Platform Helper（轻量版）

采用**单文件、纯函数工厂、组合模式**：

```
src/helpers/platform.js          # ~250-300 行，纯函数工厂
tests/unit/platform.test.js      # ~200-250 行，行为测试
```

#### 接口设计

```js
/**
 * @param {string} [platformOverride] - 仅用于测试，生产环境留空
 * @returns {PlatformHelper}
 */
function createPlatformHelper(platformOverride) {
  const platform = platformOverride || process.platform;
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';

  return {
    // --- 身份标识 ---
    platform,       // 当前平台字符串
    isMac,          // macOS
    isWin,          // Windows
    isLinux: platform === 'linux',

    // --- 路径 ---
    pathSep: isWin ? ';' : ':',

    // --- 进程管理 ---
    killTree: (pid) => { ... },
    spawnDefaults: () => isWin ? { windowsHide: true } : {},

    // --- 剪贴板 ---
    paste: (text, originalClipboard, logger) => { ... },
    checkAccessibility: () => { ... },
    openSystemSettings: () => { ... },

    // --- Shell 工具 ---
    ffmpegLocatorCmd: isWin ? 'where ffmpeg' : 'which ffmpeg',
    installerExt: isWin ? '.exe' : isMac ? '.dmg' : '.AppImage',
    prepareTrayIcon: (nativeImage, icon) => { ... },

    // --- Python ---
    pythonSearchPaths: () => { ... },
    installPython: (progressCb) => { ... },
  };
}
```

#### 消费者集成模式

```js
// 通过构造函数参数注入，带默认值
const { createPlatformHelper } = require("./platform");

class ClipboardManager {
  constructor(logger, platform = createPlatformHelper()) {
    this.platform = platform;
  }

  async pasteText(text) {
    // 不再有 pasteMacOS/pasteWindows/pasteLinux
    return this.platform.paste(text, originalClipboard, this.logger);
  }
}
```

#### 设计规则

1. **纯函数工厂**，不接受 class / 继承
2. **消费者通过 DI 接收 helper**，带 `createPlatformHelper()` 默认值
3. **单文件**，所有平台逻辑收敛于一处
4. **测试友好**：`createPlatformHelper('darwin')` 在 Windows 机器上也能测试 macOS 逻辑
5. **不重复 Electron 已有的抽象**：`getDataDirectory()` 直接用 `app.getPath('userData')`

---

## 理由

### 为什么单文件而非 Adapter 层

| 维度       | Adapter 层                             | Platform Helper                     |
| ---------- | -------------------------------------- | ----------------------------------- |
| 新增代码量 | ~1500 行（7 文件 + 10 测试文件）       | ~500 行（1 文件 + 1 测试文件）      |
| 概念复杂度 | Factory + Interface + Inheritance + DI | 工厂函数 + 组合                     |
| ISP        | 违反（上帝接口）                       | 无强制接口，按需取用                |
| 维护入口   | 7+ 文件                                | 1 文件                              |
| 升级路径   | —                                      | 若规模扩大可拆分为 `platform/` 目录 |

### 为什么从简单模块开始迁移

对抗性 Review 指出：从 clipboard（最复杂，200 行，涉及系统权限）开始风险极高。改为从最简单的属性（`pathSep`、`ffmpegLocatorCmd`）热身，建立模式和信心后再处理核心功能。

### 排除范围

以下内容**不纳入** Platform Helper：

| 排除项                                         | 原因                                                        |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `useHotkey.ts` 的 `⌘` vs `Ctrl` 检测           | 渲染进程，不同的 seam 边界（Browser API，非 Node.js）       |
| `environment.js` 的 `getDataDirectory()`       | 应直接使用 Electron `app.getPath('userData')`，无需 adapter |
| `windowManager.js` 的透明窗口最大化检测        | Electron API 行为差异，非平台概念                           |
| 5-10 行的 shell utils（tray icon, update ext） | ROI 为负，标记为 Phase 2 一起处理                           |

---

## 实施计划（TDD，4 阶段）

### Phase 1: 热身 — 简单属性收敛

**先写测试（RED），再实现（GREEN）：**

| 属性                          | win32                   | darwin         | linux          |
| ----------------------------- | ----------------------- | -------------- | -------------- |
| `pathSep`                     | `;`                     | `:`            | `:`            |
| `ffmpegLocatorCmd`            | `where ffmpeg`          | `which ffmpeg` | `which ffmpeg` |
| `spawnDefaults()`             | `{ windowsHide: true }` | `{}`           | `{}`           |
| `installerExt`                | `.exe`                  | `.dmg`         | `.AppImage`    |
| `isWin` / `isMac` / `isLinux` | ✓ / ✗ / ✗               | ✗ / ✓ / ✗      | ✗ / ✗ / ✓      |

**修改的文件：**

- `audioFileHelpers.js` → `platform.ffmpegLocatorCmd`
- `pythonEnvironment.js` → `platform.pathSep`
- `updateManager.js` → `platform.installerExt`
- `funasrServer.js` → `platform.spawnDefaults()`
- `tray.js` → `platform.prepareTrayIcon()`

### Phase 2: 进程管理 + 路径

**测试重点：**

- `killTree(pid)`：win32 调用 `spawnSync("taskkill", ["/T", "/F", "/PID"])`，其他平台调用 `process.kill(pid, "SIGKILL")`

**修改的文件：**

- `funasrServer.js` → `platform.killTree(pid)`
- `environment.js` → 替换 `getDataDirectory()` 为 `app.getPath('userData')`

### Phase 3: 剪贴板 + 辅助功能 + Python 路径（核心价值）

**测试重点：**

- `paste()` 三个平台的命令构造、超时、剪贴板恢复
- `checkAccessibility()` macOS 检查 vs 其他平台返回 true
- `pythonSearchPaths()` 各平台路径列表

**修改的文件：**

- `clipboard.js` → 删除 `pasteMacOS/pasteWindows/pasteLinux`，委托 `platform.paste()`
- `clipboard.js` → 删除 `checkAccessibilityPermissions/openSystemSettings/showAccessibilityDialog`
- `systemHandlers.js` → `platform.checkAccessibility()` / `platform.openSystemSettings()`
- `pythonEnvironment.js` → `platform.pythonSearchPaths()`
- `main.js` → `platform.pythonSearchPaths()` 替换 `setupProductionPath()`

### Phase 4（可选）: Python 安装

仅在需要 Linux 桌面支持或安装流程重构时执行。其余情况推迟。

---

## 影响分析

### 新增文件

| 文件                          | 预估行数 | 说明                       |
| ----------------------------- | -------- | -------------------------- |
| `src/helpers/platform.js`     | 250-300  | 平台收敛模块               |
| `tests/unit/platform.test.js` | 200-250  | 行为测试（非源码文本断言） |

### 修改文件

| 文件                                | 变更                                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| `src/helpers/clipboard.js`          | 删除 ~300 行平台实现，改为委托                                        |
| `src/helpers/environment.js`        | `getDataDirectory()` 改用 `app.getPath('userData')`                   |
| `src/helpers/pythonEnvironment.js`  | 使用 `platform.pathSep`、`platform.pythonSearchPaths()`               |
| `src/helpers/funasrServer.js`       | 使用 `platform.killTree()`、`platform.spawnDefaults()`                |
| `src/helpers/audioFileHelpers.js`   | 使用 `platform.ffmpegLocatorCmd`                                      |
| `src/helpers/tray.js`               | 使用 `platform.prepareTrayIcon()`                                     |
| `src/helpers/updateManager.js`      | 使用 `platform.installerExt`                                          |
| `src/helpers/ipc/systemHandlers.js` | 使用 `platform.checkAccessibility()`、`platform.openSystemSettings()` |
| `main.js`                           | 使用 `platform.pythonSearchPaths()`                                   |
| `vitest.config.js`                  | 从排除列表中移除已测试模块                                            |

### 现有测试更新

| 文件                                | 变更                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| `tests/unit/windows-compat.test.js` | 源码文本断言 → 行为断言（`createPlatformHelper('win32')`） |

### 收敛验证

最终通过以下命令验证所有 `process.platform` 检查已收敛：

```bash
grep -r "process\.platform" src/helpers/ --include="*.js" | grep -v platform.js
# 期望输出：0 行
```

---

## 风险与缓解

| 风险                                  | 缓解措施                                                                |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Phase 1 涉及多文件但改动简单          | 每个文件仅改 1 行调用方式，机械性替换                                   |
| clipboard paste 复杂（200 行）        | Phase 3 在模式成熟后执行；独立分支开发                                  |
| 迁移中混合状态                        | 每个 Phase 自包含；旧代码在被替换前仍然工作                             |
| `windows-compat.test.js` 源码断言失效 | 同一 commit 中迁移为行为断言                                            |
| 单文件增长过大                        | 若超过 400 行，拆分为 `platform/clipboard.js`、`platform/process.js` 等 |

---

## 对抗性 Review 记录

本方案经历了三方对抗性 Review，以下是关键发现及对应措施：

### Reviewer 1: 资深架构师

| 发现                                          | 级别     | 处置                                                                |
| --------------------------------------------- | -------- | ------------------------------------------------------------------- |
| 原方案 `PlatformAdapter` 违反 ISP，是上帝接口 | CRITICAL | → 改为无强制接口的 Helper 对象，消费者按需取用                      |
| `basePlatform` 继承结构不适合 JS              | CRITICAL | → 改为纯函数工厂 + 组合                                             |
| Electron 已有 `app.getPath()` 等抽象          | HIGH     | → `getDataDirectory()` 直接用 `app.getPath('userData')`，不重复抽象 |

### Reviewer 2: TDD 专家

| 发现                                       | 级别     | 处置                                                 |
| ------------------------------------------ | -------- | ---------------------------------------------------- |
| `process.platform` 是只读属性，mock 不可靠 | CRITICAL | → `createPlatformHelper(platformOverride?)` 接受参数 |
| 10 个测试文件维护成本过高                  | HIGH     | → 精简为 1 个测试文件                                |
| 源码文本断言迁移风险                       | HIGH     | → 同步迁移为行为断言                                 |
| mock 覆盖率 90% 意义有限                   | MEDIUM   | → 目标调整为 85%，focus 共享逻辑                     |

### Reviewer 3: 风险分析师

| 发现                              | 级别     | 处置                                        |
| --------------------------------- | -------- | ------------------------------------------- |
| 从最复杂的 clipboard 开始风险过高 | CRITICAL | → 改为从 `pathSep`/`ffmpegLocator` 热身开始 |
| Phase 5-6 ROI 为负                | HIGH     | → 标记为 optional，合并到 Phase 1-2         |
| 中间混合状态可能引入 bug          | HIGH     | → 每个 Phase 自包含 + grep 审计             |
| 回滚策略缺失                      | MEDIUM   | → 每个 Phase 在独立分支开发                 |

---

## 未来演进

如果项目规模扩大（多团队维护、5+ 个平台适配器），可以将 `platform.js` 拆分为目录结构：

```
src/helpers/platform/
├── index.js           # createPlatformHelper 工厂
├── clipboard.js       # paste / checkAccessibility / openSystemSettings
├── process.js         # killTree / spawnDefaults
├── paths.js           # pathSep / pythonSearchPaths
├── python.js          # installPython
└── shell.js           # ffmpegLocatorCmd / installerExt / prepareTrayIcon
```

当前阶段不执行此拆分——YAGNI。
