# Murmur Manager 深度测试设计 — 12 个覆盖率排除文件

> 日期：2026-07-25
> 范围：`src/helpers/` 下 12 个被 `vitest.config.ts` coverage.exclude 的 manager
> 目标：识别 80+ 可测行为，给出精确的 mock setup + 函数调用 + 断言
> 关键发现：**并非所有排除文件都真的依赖 electron** — 4 个文件完全不导入 electron，可直接全测

---

## 0. 关键发现：排除原因分类

逐文件核查 `import`/`require("electron")` 后，12 个文件分 3 类：

| 类别                                           | 文件                                                         | 排除原因真相                               | 可测性           |
| ---------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ | ---------------- |
| **A. 顶层 `import electron`**                  | clipboard, hotkeyManager, tray, windowManager, updateManager | 模块加载即失败，必须 `vi.mock("electron")` | 需 mock 才能加载 |
| **B. 惰性 `require("electron")` in try/catch** | modelManager, pythonEnvironment, logManager                  | 模块可加载；方法内 try/catch 兜底          | 多数方法可纯测   |
| **C. 完全不导入 electron**                     | funasrServer, pythonInstaller, environment, funasrManager    | **被错误排除！** 无任何 electron 依赖      | 可全测，零 mock  |

**结论**：`environment.ts`、`pythonInstaller.ts`、`funasrServer.ts`、`funasrManager.ts` 应从 coverage 排除列表移除（C 类），其余 8 个用 mock 后仍有大量纯逻辑可测。

---

## 1. 通用 mock 基础设施

### 1.1 三种 mock 模式（按文件类别选用）

**模式 A — 顶层 import electron（clipboard/hotkeyManager/tray/windowManager/updateManager）**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => "/tmp/ud"),
    getVersion: vi.fn(() => "1.0.0"),
    getAppPath: vi.fn(() => "/app"),
    quit: vi.fn(),
  },
  // ... 按需补 Tray/Menu/BrowserWindow/session/net/shell/Notification
}));

import ClipboardManager from "../../src/helpers/clipboard";
```

**模式 B — 惰性 require electron（modelManager/pythonEnvironment/logManager）**

无需 `vi.mock`；代码已 try/catch 兜底（落 `os.tmpdir()` / `process.cwd()`）。直接 `import` 即可。

**模式 C — 无 electron（funasrServer/pythonInstaller/environment/funasrManager）**

直接 `import`，无需任何 electron mock。

### 1.2 通用 child_process mock

```ts
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
  spawnSync: vi.fn(),
}));
```

### 1.3 通用 tmpdir + fs 注入

```ts
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
// afterEach: fs.rmSync(tmpDir, { recursive: true, force: true });
```

---

## 2. 逐文件测试设计

### 2.1 clipboard.ts

**现有测试**：0 个 manager 测试（仅 `clipboardHandlers.test.ts` 测 IPC 层）
**导出**：`export default ClipboardManager`（类）
**electron 依赖**：顶层 `import { clipboard } from "electron"`（模式 A）
**spawn 依赖**：`child_process.spawn`（osascript/powershell/xdotool）

**纯逻辑方法**（无 electron、无 spawn）：

- `safeLog(message, data)` — 仅调 logger；EPIPE 静默
- `enableMacOSAccessibility()` — 非 darwin 直接 return true（早返回路径）

**需 mock electron.clipboard**：`copyText`, `readClipboard`, `writeClipboard`（仅调 `clipboard.writeText/readText`）

**需 mock electron + spawn**：`pasteText`, `pasteMacOS`, `pasteWindows`, `pasteLinux`, `checkAccessibilityPermissions`, `showAccessibilityDialog`, `openSystemSettings`, `insertTextDirectly`

**测试用例**（12 个）：

```ts
// mock setup（模式 A + child_process）
vi.mock("electron", () => ({
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
}));
vi.mock("child_process", () => ({ spawn: vi.fn() }));
import { clipboard } from "electron";
import { spawn } from "child_process";
import ClipboardManager from "../../src/helpers/clipboard";

// 1. safeLog — 有 logger 时调用 logger.info
it("safeLog calls logger.info when logger present", () => {
  const logger = { info: vi.fn() };
  const m = new ClipboardManager(logger);
  m.safeLog("msg", { a: 1 });
  expect(logger.info).toHaveBeenCalledWith("msg", { a: 1 });
});

// 2. safeLog — 无 logger 时静默不抛
it("safeLog is silent when logger is null", () => {
  const m = new ClipboardManager(null);
  expect(() => m.safeLog("msg")).not.toThrow();
});

// 3. safeLog — logger.info 抛 EPIPE 时静默（不写 stderr）
it("safeLog swallows EPIPE from logger.info", () => {
  const writeSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const logger = {
    info: vi.fn(() => {
      const e = new Error();
      e.code = "EPIPE";
      throw e;
    }),
  };
  const m = new ClipboardManager(logger);
  expect(() => m.safeLog("x")).not.toThrow();
  expect(writeSpy).not.toHaveBeenCalled();
  writeSpy.mockRestore();
});

// 4. safeLog — 非 EPIPE 错误写 stderr
it("safeLog writes stderr for non-EPIPE logger errors", () => {
  const writeSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const logger = {
    info: vi.fn(() => {
      throw new Error("boom");
    }),
  };
  const m = new ClipboardManager(logger);
  m.safeLog("x");
  expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
  writeSpy.mockRestore();
});

// 5. enableMacOSAccessibility — 非 darwin 平台直接返回 true
it("enableMacOSAccessibility returns true on non-darwin", async () => {
  const orig = process.platform;
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  const m = new ClipboardManager(null);
  await expect(m.enableMacOSAccessibility()).resolves.toBe(true);
  Object.defineProperty(process, "platform", {
    value: orig,
    configurable: true,
  });
});

// 6. checkAccessibilityPermissions — 非 darwin 返回 true（无需 spawn）
it("checkAccessibilityPermissions returns true on non-darwin", async () => {
  const orig = process.platform;
  Object.defineProperty(process, "platform", {
    value: "linux",
    configurable: true,
  });
  const m = new ClipboardManager(null);
  await expect(m.checkAccessibilityPermissions()).resolves.toBe(true);
  Object.defineProperty(process, "platform", {
    value: orig,
    configurable: true,
  });
});

// 7. copyText — 成功返回 { success: true }
it("copyText returns success when clipboard.writeText succeeds", async () => {
  (clipboard.writeText as any).mockImplementation(() => {});
  const m = new ClipboardManager(null);
  await expect(m.copyText("hello")).resolves.toEqual({ success: true });
  expect(clipboard.writeText).toHaveBeenCalledWith("hello");
});

// 8. copyText — writeText 抛错时透传
it("copyText rethrows clipboard.writeText error", async () => {
  (clipboard.writeText as any).mockImplementation(() => {
    throw new Error("denied");
  });
  const m = new ClipboardManager(null);
  await expect(m.copyText("x")).rejects.toThrow("denied");
});

// 9. readClipboard — 返回 clipboard.readText 的值
it("readClipboard returns clipboard content", async () => {
  (clipboard.readText as any).mockReturnValue("clip-content");
  const m = new ClipboardManager(null);
  await expect(m.readClipboard()).resolves.toBe("clip-content");
});

// 10. readClipboard — readText 返回空时返回空字符串
it("readClipboard returns empty string when readText returns falsy", async () => {
  (clipboard.readText as any).mockReturnValue("");
  const m = new ClipboardManager(null);
  await expect(m.readClipboard()).resolves.toBe("");
});

// 11. writeClipboard — 成功返回 { success: true }
it("writeClipboard returns success object", async () => {
  (clipboard.writeText as any).mockImplementation(() => {});
  const m = new ClipboardManager(null);
  await expect(m.writeClipboard("data")).resolves.toEqual({ success: true });
  expect(clipboard.writeText).toHaveBeenCalledWith("data");
});

// 12. insertTextDirectly — 委托给 pasteText
it("insertTextDirectly delegates to pasteText", async () => {
  const m = new ClipboardManager(null);
  const spy = vi.spyOn(m, "pasteText").mockResolvedValue(undefined);
  await m.insertTextDirectly("text");
  expect(spy).toHaveBeenCalledWith("text");
});
```

**Electron-dependent 方法（mock 备注）**：

- `pasteText` — 需 mock `clipboard.readText/writeText` + `spawn` + 平台分支；可测"无权限时抛错带剪贴板提示"
- `pasteMacOS/pasteWindows/pasteLinux` — spawn 的 close/error/timeout 三分支；mock spawn 返回伪 ChildProcess 并触发回调
- `showAccessibilityDialog` — 3 个 stuck 关键词分支 + spawn dialog
- `openSystemSettings` — 3 命令级联重试 + 2 个后备命令

---

### 2.2 hotkeyManager.ts

**现有测试**：0 个 manager 测试（仅 `hotkeyHandlers.test.ts`）
**导出**：`export default HotkeyManager`（类）
**electron 依赖**：顶层 `import { globalShortcut } from "electron"`（模式 A）

**纯逻辑方法**（不调 globalShortcut）：

- `handleF2Click()` — 双击检测窗口（500ms）+ 清理过期记录
- `handleF2DoubleClick()` — 根据 isRecording 决定 action，回调 data 形状
- `getRegisteredHotkeys()` — Map keys → 数组
- `isHotkeyRegistered(hotkey)` — Map.has
- `setRecordingState(bool)` / `getRecordingState()` — 状态读写
- `registerHotkey` 内部的**防抖闭包**（200ms 内重复触发被抑制）

**需 mock globalShortcut**：`registerF2DoubleClick`, `registerHotkey`, `unregisterHotkey`, `unregisterAllHotkeys`

**测试用例**（14 个）：

```ts
vi.mock("electron", () => ({
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
  },
}));
import { globalShortcut } from "electron";
import HotkeyManager from "../../src/helpers/hotkeyManager";

// 1. getRecordingState 默认 false
it("getRecordingState defaults to false", () => {
  expect(new HotkeyManager().getRecordingState()).toBe(false);
});

// 2. setRecordingState/getRecordingState 往返
it("setRecordingState updates and getRecordingState returns it", () => {
  const m = new HotkeyManager();
  m.setRecordingState(true);
  expect(m.getRecordingState()).toBe(true);
});

// 3. getRegisteredHotkeys 初始为空数组
it("getRegisteredHotkeys returns empty array initially", () => {
  expect(new HotkeyManager().getRegisteredHotkeys()).toEqual([]);
});

// 4. isHotkeyRegistered 未注册时返回 false
it("isHotkeyRegistered returns false for unregistered hotkey", () => {
  expect(new HotkeyManager().isHotkeyRegistered("Cmd+Shift+Space")).toBe(false);
});

// 5. handleF2Click 单击不触发双击回调
it("handleF2Click with single click does not invoke callback", () => {
  const cb = vi.fn();
  const m = new HotkeyManager();
  m.onF2DoubleClick = cb; // 通过 registerF2DoubleClick 设置或直接赋值（私有）
  m.handleF2Click();
  expect(cb).not.toHaveBeenCalled();
});

// 6. handleF2Click 两次快速点击触发双击回调
it("handleF2Click twice within window triggers double-click callback", () => {
  const cb = vi.fn();
  const m = new HotkeyManager();
  m.registerF2DoubleClick(cb); // 注册但不依赖 globalShortcut.register 成功
  (globalShortcut.register as any).mockReturnValueOnce(true);
  m.handleF2Click();
  m.handleF2Click();
  expect(cb).toHaveBeenCalledTimes(1);
});

// 7. handleF2DoubleClick — isRecording=false 时 action="start"
it("handleF2DoubleClick yields action=start when not recording", () => {
  const cb = vi.fn();
  const m = new HotkeyManager();
  m.setRecordingState(false);
  m.onF2DoubleClick = cb;
  m.handleF2DoubleClick();
  expect(cb).toHaveBeenCalledWith({ action: "start", currentState: false });
});

// 8. handleF2DoubleClick — isRecording=true 时 action="stop"
it("handleF2DoubleClick yields action=stop when recording", () => {
  const cb = vi.fn();
  const m = new HotkeyManager();
  m.setRecordingState(true);
  m.onF2DoubleClick = cb;
  m.handleF2DoubleClick();
  expect(cb).toHaveBeenCalledWith({ action: "stop", currentState: true });
});

// 9. handleF2DoubleClick — 无回调时不抛
it("handleF2DoubleClick without callback does not throw", () => {
  const m = new HotkeyManager();
  expect(() => m.handleF2DoubleClick()).not.toThrow();
});

// 10. registerF2DoubleClick — globalShortcut.register 成功后 hotkey 列表含 F2
it("registerF2DoubleClick adds F2 to registered list on success", () => {
  (globalShortcut.register as any).mockReturnValue(true);
  const m = new HotkeyManager();
  const r = m.registerF2DoubleClick(() => {});
  expect(r).toBe(true);
  expect(m.isHotkeyRegistered("F2")).toBe(true);
  expect(m.getRegisteredHotkeys()).toContain("F2");
});

// 11. registerF2DoubleClick — register 失败返回 false 且不入列表
it("registerF2DoubleClick returns false and does not register when globalShortcut fails", () => {
  (globalShortcut.register as any).mockReturnValue(false);
  const m = new HotkeyManager();
  expect(m.registerF2DoubleClick(() => {})).toBe(false);
  expect(m.isHotkeyRegistered("F2")).toBe(false);
});

// 12. registerF2DoubleClick — 已注册时仅更新回调，返回 true，不重复注册
it("registerF2DoubleClick updates callback without re-registering when already registered", () => {
  (globalShortcut.register as any).mockReturnValue(true);
  const m = new HotkeyManager();
  m.registerF2DoubleClick(() => 1);
  (globalShortcut.register as any).mockClear();
  const cb2 = () => 2;
  const r = m.registerF2DoubleClick(cb2);
  expect(r).toBe(true);
  expect(globalShortcut.register).not.toHaveBeenCalled();
});

// 13. registerHotkey 防抖 — 200ms 内第二次触发被抑制
it("registerHotkey debounce suppresses callback within 200ms", async () => {
  (globalShortcut.register as any).mockImplementation((_k, cb) => {
    (cb as any)._test = true;
    return true;
  });
  const userCb = vi.fn();
  const m = new HotkeyManager();
  m.registerHotkey("Cmd+Shift+Space", userCb);
  // 取出注册时传入的 debounced 回调并连续调用两次
  const debounced = (globalShortcut.register as any).mock.calls.at(-1)[1];
  debounced();
  debounced();
  expect(userCb).toHaveBeenCalledTimes(1);
});

// 14. registerHotkey 重复注册同一热键返回 true 且跳过
it("registerHotkey returns true and skips for already-registered hotkey", () => {
  (globalShortcut.register as any).mockReturnValue(true);
  const m = new HotkeyManager();
  m.registerHotkey("X", () => {});
  (globalShortcut.register as any).mockClear();
  expect(m.registerHotkey("X", () => {})).toBe(true);
  expect(globalShortcut.register).not.toHaveBeenCalled();
});
```

**额外可测（mock globalShortcut）**：`unregisterHotkey`（已注册→调 unregister+删除+返回 true；未注册→返回 false）、`unregisterAllHotkeys`（清空 Map + 调 unregisterAll + 重置 f2ClickTimes）。

---

### 2.3 tray.ts

**现有测试**：0 个
**导出**：`export default TrayManager`（类）
**electron 依赖**：顶层 `import { Tray, Menu, nativeImage, dialog, app } from "electron"`（模式 A）

**纯逻辑方法**：

- `getTrayIconPath()` — dev/prod 分支（dev 用 `app.getAppPath()`，prod 用 `process.resourcesPath`）
- `setStatus(status)` — 无 tray 时早返回；switch 三分支（recording/processing/ready/default）
- `setWindows(mainWindow)` — 简单赋值
- `destroy()` — tray 为 null 时安全

**需 mock electron**：`createTray`（Tray/nativeImage/fs）、`updateContextMenu`（Menu/dialog/app）、`destroy`（tray.destroy）

**测试用例**（8 个）：

```ts
vi.mock("electron", () => ({
  Tray: vi.fn(),
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: {
    createFromPath: vi.fn(() => ({})),
    createEmpty: vi.fn(() => ({})),
  },
  dialog: { showMessageBox: vi.fn() },
  app: {
    getVersion: vi.fn(() => "9.9.9"),
    getAppPath: vi.fn(() => "/dev/app"),
  },
}));
import { app, Tray } from "electron";
import path from "path";
import TrayManager from "../../src/helpers/tray";

// 1. getTrayIconPath — dev 环境
it("getTrayIconPath returns dev path when NODE_ENV=development", () => {
  process.env.NODE_ENV = "development";
  (app.getAppPath as any).mockReturnValue("/dev/app");
  const m = new TrayManager();
  expect(m.getTrayIconPath()).toBe(path.join("/dev/app", "assets", "icon.png"));
});

// 2. getTrayIconPath — prod 环境
it("getTrayIconPath returns resourcesPath path when not development", () => {
  process.env.NODE_ENV = "production";
  const m = new TrayManager();
  expect(m.getTrayIconPath()).toBe(
    path.join(process.resourcesPath, "assets", "icon.png"),
  );
  process.env.NODE_ENV = "test";
});

// 3. setStatus — tray 未创建时安全无操作（不抛）
it("setStatus is a no-op when tray is null", () => {
  const m = new TrayManager();
  expect(() => m.setStatus("recording")).not.toThrow();
});

// 4. setStatus — recording 分支设置工具提示
it("setStatus recording sets recording tooltip", () => {
  const setToolTip = vi.fn();
  const m = new TrayManager();
  (m as any).tray = { setToolTip };
  m.setStatus("recording");
  expect(setToolTip).toHaveBeenCalledWith("Murmur - 正在录音...");
});

// 5. setStatus — processing 分支
it("setStatus processing sets processing tooltip", () => {
  const setToolTip = vi.fn();
  const m = new TrayManager();
  (m as any).tray = { setToolTip };
  m.setStatus("processing");
  expect(setToolTip).toHaveBeenCalledWith("Murmur - 正在处理...");
});

// 6. setStatus — ready / 默认分支
it("setStatus ready sets default tooltip", () => {
  const setToolTip = vi.fn();
  const m = new TrayManager();
  (m as any).tray = { setToolTip };
  m.setStatus("ready");
  expect(setToolTip).toHaveBeenCalledWith("Murmur - 中文语音转文字");
});

// 7. setStatus — 未知值走 default 分支
it("setStatus unknown value falls through to default", () => {
  const setToolTip = vi.fn();
  const m = new TrayManager();
  (m as any).tray = { setToolTip };
  m.setStatus("anything-else");
  expect(setToolTip).toHaveBeenCalledWith("Murmur - 中文语音转文字");
});

// 8. destroy — tray 为 null 时安全
it("destroy is safe when tray is null", () => {
  const m = new TrayManager();
  expect(() => m.destroy()).not.toThrow();
});
```

**Mock 备注 — Electron-dependent 方法**：

- `createTray`：mock `fs.existsSync`（true→createFromPath+resize+setTemplateImage；false→createEmpty）、`new Tray()`、tray.on。覆盖"图标存在但 macOS 平台"与"图标缺失"两分支
- `updateContextMenu`：tray=null 早返回；否则验证 `Menu.buildFromTemplate` 被调用且菜单含 5 项（显示/separator/关于/separator/退出），并调 `tray.setContextMenu`
- `destroy`：tray 非空时调 `tray.destroy()` 并置 null

---

### 2.4 windowManager.ts

**现有测试**：7 个（`windowManager-events.test.js`，用 `Module._resolveFilename` 注入 electron stub）
**导出**：`export default WindowManager`（类）
**electron 依赖**：顶层 `import { BrowserWindow, session, app } from "electron"`（模式 A）

**纯逻辑方法**：

- `setDefaultAlwaysOnTop(bool)` — 赋值 `_alwaysOnTop`
- `_setupCSP()` — `_cspSetup` 幂等守卫；dev/prod CSP 字符串差异（已有测试覆盖 alwaysOnTop + maximize 事件）

**已有覆盖（无需重复）**：maximize/unmaximize 事件、alwaysOnTop 默认值、history/settings 窗口的 alwaysOnTop

**新增测试用例**（7 个）：

```ts
// 复用现有 windowManager-events.test.js 的 Module._resolveFilename 注入模式，
// 或迁移到 vi.mock（windowManager.ts 已是 .ts + import electron）
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function () {
    this.webContents = { send: vi.fn() };
    this.on = vi.fn();
    this.loadURL = vi.fn(async () => {});
    this.loadFile = vi.fn(async () => {});
    this.focus = vi.fn();
    this.show = vi.fn();
    this.hide = vi.fn();
    this.close = vi.fn();
    this.isDestroyed = vi.fn(() => false);
    this.setAlwaysOnTop = vi.fn();
    return this;
  }),
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  app: { getAppPath: vi.fn(() => "/app") },
}));
import { session, BrowserWindow } from "electron";
import WindowManager from "../../src/helpers/windowManager";

// 1. 构造函数初始化所有窗口为 null + _alwaysOnTop=true
it("constructor initializes windows null and alwaysOnTop true", () => {
  const wm = new WindowManager();
  expect(wm.mainWindow).toBeNull();
  expect(wm.historyWindow).toBeNull();
  expect(wm.settingsWindow).toBeNull();
  expect((wm as any)._alwaysOnTop).toBe(true);
  expect((wm as any)._cspSetup).toBe(false);
});

// 2. setDefaultAlwaysOnTop 设置内部标志
it("setDefaultAlwaysOnTop updates internal flag", () => {
  const wm = new WindowManager();
  wm.setDefaultAlwaysOnTop(false);
  expect((wm as any)._alwaysOnTop).toBe(false);
});

// 3. _setupCSP 幂等 — 第二次调用不重复注册
it("_setupCSP is idempotent — second call does not re-register handler", () => {
  const onHeadersReceived = vi.fn();
  (session.defaultSession.webRequest as any).onHeadersReceived =
    onHeadersReceived;
  const wm = new WindowManager();
  wm._setupCSP();
  wm._setupCSP();
  expect(onHeadersReceived).toHaveBeenCalledTimes(1);
});

// 4. _setupCSP prod CSP 头注入回调返回正确响应头（prod 分支）
it("_setupCSP prod callback injects restrictive CSP", () => {
  let captured;
  (session.defaultSession.webRequest as any).onHeadersReceived = (cb) => {
    captured = cb;
  };
  const wm = new WindowManager();
  process.env.NODE_ENV = "production";
  wm._setupCSP();
  const ret = captured({ responseHeaders: { X: ["1"] } }, () => {});
  expect(ret.responseHeaders["Content-Security-Policy"][0]).toContain(
    "default-src 'self'",
  );
  expect(ret.responseHeaders["Content-Security-Policy"][0]).not.toContain(
    "unsafe-eval",
  );
});

// 5. _setupCSP dev CSP 含 unsafe-eval + ws://localhost
it("_setupCSP dev callback injects permissive CSP with eval and ws", () => {
  let captured;
  (session.defaultSession.webRequest as any).onHeadersReceived = (cb) => {
    captured = cb;
  };
  const wm = new WindowManager();
  process.env.NODE_ENV = "development";
  wm._setupCSP();
  const ret = captured({ responseHeaders: {} }, () => {});
  expect(ret.responseHeaders["Content-Security-Policy"][0]).toMatch(
    /unsafe-eval|ws:\/\/localhost/,
  );
});

// 6. createMainWindow — 已存在时 focus 而不新建
it("createMainWindow focuses existing window instead of creating new", async () => {
  const wm = new WindowManager();
  const existing = { focus: vi.fn() };
  wm.mainWindow = existing as any;
  const r = await wm.createMainWindow();
  expect(r).toBe(existing);
  expect(existing.focus).toHaveBeenCalled();
  expect(BrowserWindow).not.toHaveBeenCalled();
});

// 7. createMainWindow — _creatingMainWindow 标志为 true 时返回 null
it("createMainWindow returns null when creation already in progress", async () => {
  const wm = new WindowManager();
  (wm as any)._creatingMainWindow = true;
  const r = await wm.createMainWindow();
  expect(r).toBeNull();
});
```

**额外可测（基于现有 mock 模式扩展）**：`closeAllWindows`（三个窗口各自 close 被调）、`hideHistoryWindow`/`closeHistoryWindow`（null 安全 + 非 null 调用）、`showHistoryWindow`（已有→show+focus+setAlwaysOnTop；无→createHistoryWindow().then）。

---

### 2.5 funasrServer.ts ★（无 electron！）

**现有测试**：5 个（`funasrServer-crash-restart.test.js`，已 mock electron 但实际非必需）
**导出**：`export default FunASRServer` + `export function calculateTranscriptionTimeout`（命名）+ `static calculateTranscriptionTimeout`
**electron 依赖**：**无**（仅 child_process/fs/path）— 应从 coverage 排除列表移除
**依赖**：`ServerMessageRouter`, `audioFileHelpers`, `ipc-contracts`

**纯逻辑函数（最易测）**：

- `calculateTranscriptionTimeout(bytes)` — 纯数学：MIN/MAX 边界、线性比例、label 格式化
- `resetState()` — 状态重置
- `_stopHealthMonitor()` — 清 interval

**需 mock spawn + messageRouter**：`_startFunASRServer`, `_startHealthMonitor`, `_handleServerCrash`, `_sendServerCommand`, `_stopFunASRServer`, `gracefulShutdown`, `transcribeAudio`, `transcribeFile`, `diarizeAudio`, `cancelTranscription`

**测试用例**（18 个）：

```ts
import { describe, it, expect, vi } from "vitest";
// 注意：calculateTranscriptionTimeout 是命名导出，直接导入
import {
  calculateTranscriptionTimeout,
  default as FunASRServer,
} from "../../src/helpers/funasrServer";

describe("calculateTranscriptionTimeout", () => {
  // 1. 0 字节 → MIN_TIMEOUT_MS (300_000)
  it("returns MIN_TIMEOUT for 0 bytes", () => {
    const r = calculateTranscriptionTimeout(0);
    expect(r.ms).toBe(300_000);
  });

  // 2. 负数输入 → 当作 0（Math.max(0, n)）
  it("treats negative bytes as 0 (clamped to MIN)", () => {
    expect(calculateTranscriptionTimeout(-9999).ms).toBe(300_000);
  });

  // 3. 1MB → MIN + 6s = 306_000
  it("adds 6s per MB on top of MIN", () => {
    const oneMB = 1024 * 1024;
    expect(calculateTranscriptionTimeout(oneMB).ms).toBe(300_000 + 6_000);
  });

  // 4. 超大文件封顶 MAX_TIMEOUT_MS (3_600_000)
  it("caps at MAX_TIMEOUT for very large files", () => {
    const hugeMB = 200; // 200MB → MIN + 200*6000 = 1_500_000 仍在范围；用 600MB 触顶
    const r = calculateTranscriptionTimeout(600 * 1024 * 1024);
    expect(r.ms).toBeLessThanOrEqual(3_600_000);
    expect(r.ms).toBe(3_600_000); // 300000 + 600*6000 = 3_900_000 → 封顶 3_600_000
  });

  // 5. label 格式含"文件转录超时"和分钟数
  it("label contains chinese prefix and minute count", () => {
    const r = calculateTranscriptionTimeout(0);
    expect(r.label).toMatch(/文件转录超时/);
    expect(r.label).toContain("5"); // 300000ms = 5 分钟
  });

  // 6. label 分钟数四舍五入（306000ms → 5 分钟，向下取整 Math.round(5.1)=5）
  it("label minutes are Math.round of ms/60000", () => {
    const r = calculateTranscriptionTimeout(1024 * 1024); // 306000ms
    const expectedMin = Math.round(306000 / 60000);
    expect(r.label).toContain(String(expectedMin));
  });
});

describe("FunASRServer instance behavior", () => {
  // 7. 构造函数初始状态
  it("constructor sets default state", () => {
    const s = new FunASRServer();
    expect(s.serverReady).toBe(false);
    expect(s.modelsInitialized).toBe(false);
    expect(s.initializationPromise).toBeNull();
    expect(s.restartCount).toBe(0);
    expect(s.maxRestarts).toBe(3);
    expect(s.healthMonitorInterval).toBeNull();
    expect(s.messageRouter).toBeDefined();
  });

  // 8. resetState 清空状态
  it("resetState clears all runtime state", () => {
    const s = new FunASRServer();
    s.serverReady = true;
    s.modelsInitialized = true;
    s.initializationPromise = Promise.resolve() as any;
    s.restartCount = 5;
    s.resetState();
    expect(s.serverReady).toBe(false);
    expect(s.modelsInitialized).toBe(false);
    expect(s.initializationPromise).toBeNull();
    expect(s.restartCount).toBe(0);
  });

  // 9. _stopHealthMonitor — 无 interval 时安全
  it("_stopHealthMonitor is safe when no interval set", () => {
    const s = new FunASRServer();
    expect(() => s._stopHealthMonitor()).not.toThrow();
  });

  // 10. _startHealthMonitor 重置 restartCount=0 并设置 interval
  it("_startHealthMonitor resets restartCount and sets interval", () => {
    vi.useFakeTimers();
    const s = new FunASRServer();
    s.restartCount = 7;
    s._startHealthMonitor();
    expect(s.restartCount).toBe(0);
    expect(s.healthMonitorInterval).not.toBeNull();
    s._stopHealthMonitor();
    vi.useRealTimers();
  });

  // 11. _startHealthMonitor 幂等 — 先停旧再开新
  it("_startHealthMonitor clears previous interval before setting new", () => {
    vi.useFakeTimers();
    const s = new FunASRServer();
    s._startHealthMonitor();
    const first = s.healthMonitorInterval;
    s._startHealthMonitor();
    const second = s.healthMonitorInterval;
    expect(second).not.toBe(first);
    s._stopHealthMonitor();
    vi.useRealTimers();
  });

  // 12. _sendServerCommand — 未就绪时抛 "FunASR服务器未就绪"
  it("_sendServerCommand rejects when server not ready", async () => {
    const s = new FunASRServer();
    await expect(s._sendServerCommand({ action: "x" })).rejects.toThrow(
      /未就绪/,
    );
  });

  // 13. _sendServerCommand — serverProcess 为 null 时拒绝
  it("_sendServerCommand rejects when serverProcess is null even if serverReady true", async () => {
    const s = new FunASRServer();
    s.serverReady = true; // 异常状态
    await expect(s._sendServerCommand({ action: "x" })).rejects.toThrow(
      /未就绪/,
    );
  });

  // 14. transcribeFile — 无效路径返回 INVALID_PATH
  it("transcribeFile rejects empty path with INVALID_PATH", async () => {
    const s = new FunASRServer();
    const r = await s.transcribeFile("", {});
    expect(r.success).toBe(false);
    expect((r as any).code).toBe("INVALID_PATH");
  });

  // 15. transcribeFile — 非字符串路径返回 INVALID_PATH
  it("transcribeFile rejects non-string path", async () => {
    const s = new FunASRServer();
    const r = await s.transcribeFile(null as any, {});
    expect((r as any).code).toBe("INVALID_PATH");
  });

  // 16. transcribeFile — 不支持的扩展名返回 FORMAT_NOT_SUPPORTED
  it("transcribeFile rejects unsupported extension with FORMAT_NOT_SUPPORTED", async () => {
    const s = new FunASRServer();
    const r = await s.transcribeFile("/tmp/file.xyz", {});
    expect((r as any).code).toBe("FORMAT_NOT_SUPPORTED");
  });

  // 17. diarizeAudio — 未就绪返回 { success:false, error }
  it("diarizeAudio returns failure when server not ready", async () => {
    const s = new FunASRServer();
    const r = await s.diarizeAudio("/x.wav", []);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/未就绪/);
  });

  // 18. cancelTranscription — 未就绪返回失败
  it("cancelTranscription returns failure when server not ready", async () => {
    const s = new FunASRServer();
    const r = await s.cancelTranscription();
    expect(r.success).toBe(false);
  });
});
```

**Mock 备注 — spawn 相关（mock `fs.existsSync` + 伪 ChildProcess）**：

- `_startFunASRServer`：serverPath 不存在 → 返回 undefined（不 spawn）；存在 → spawn，监听 stdout JSON 触发 init、stderr、close（crash 路径）、error、120s 超时
- `_handleServerCrash`：已有 5 个测试；可补充"startupParams 为 null 时不重启"
- `gracefulShutdown`：proc=null 早返回；win32 → spawnSync taskkill；非 win32 → proc.kill SIGKILL；5s 超时兜底
- `transcribeFile` 完整路径：文件不存在 → FILE_NOT_FOUND；>500MB → FILE_TOO_LARGE；server 未就绪 → SERVER_NOT_READY
- `transcribeAudio`：server 未就绪但 init promise 存在 → await；仍未就绪 → 抛错

---

### 2.6 modelManager.ts ★（惰性 require，可纯测）

**现有测试**：3 个（`modelManager-shape.test.js`）
**导出**：`export default ModelManager`（类）
**electron 依赖**：方法内 `try { require("electron") } catch {}` 兜底（模式 B）
**模块级状态**：`globalModelCheckCache`、`globalModelCheckTime`（需 `vi.resetModules()` 重置）

**纯逻辑方法**：

- `_verifyModel(modelFile, config)` — 目录（找 model.pt 等）/ 文件（size >= 90% expected）/ 异常 false
- `findDamoRoot(startDir, depth, maxDepth)` — 递归找 damo/ 目录含 speech_paraformer
- `clearCache()` — 清全局缓存
- `checkModelFiles()` — 缓存命中、目录缺失、模型完整/缺失/部分
- `getDownloadProgress()` — 进度计算、百分比封顶 100
- `getDownloadScriptPath()` — dev/prod 路径
- `getModelCachePath()` — 多候选目录探测

**测试用例**（15 个）：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

describe("ModelManager", () => {
  let ModelManager: any;
  let tmpDir: string;
  beforeEach(() => {
    vi.resetModules();
    ModelManager = require("../../src/helpers/modelManager").default;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-"));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // 1. 构造函数 — 3 个 modelConfigs，required 标志正确
  it("constructor loads 3 model configs with correct required flags", () => {
    const m = new ModelManager();
    expect(Object.keys(m.modelConfigs).sort()).toEqual(["asr", "punc", "vad"]);
    expect(m.modelConfigs.asr.required).toBe(true);
    expect(m.modelConfigs.vad.required).toBe(true);
    expect(m.modelConfigs.punc.required).toBe(false);
  });

  // 2. clearCache 重置全局缓存
  it("clearCache resets global cache", async () => {
    const m = new ModelManager();
    m.getModelCachePath = () => tmpDir;
    await m.checkModelFiles(); // 填充缓存
    m.clearCache();
    // 再次调用应重新执行（间接验证缓存被清）
    const spy = vi.spyOn(m, "getModelCachePath");
    await m.checkModelFiles();
    expect(spy).toHaveBeenCalled();
  });

  // 3. _verifyModel — 目录含 model.pt 返回 true
  it("_verifyModel returns true for dir containing model.pt", () => {
    const m = new ModelManager();
    const dir = path.join(tmpDir, "model-dir");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "model.pt"), "x");
    expect(m._verifyModel(dir, { expected_size: 100 } as any)).toBe(true);
  });

  // 4. _verifyModel — 目录含 pytorch_model.bin 返回 true
  it("_verifyModel returns true for dir with pytorch_model.bin", () => {
    const m = new ModelManager();
    const dir = path.join(tmpDir, "d2");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "pytorch_model.bin"), "x");
    expect(m._verifyModel(dir, {} as any)).toBe(true);
  });

  // 5. _verifyModel — 目录无识别文件返回 false
  it("_verifyModel returns false for dir without known model files", () => {
    const m = new ModelManager();
    const dir = path.join(tmpDir, "empty");
    fs.mkdirSync(dir);
    expect(m._verifyModel(dir, {} as any)).toBe(false);
  });

  // 6. _verifyModel — 文件 size >= 90% expected 返回 true
  it("_verifyModel returns true when file size >= 90% of expected", () => {
    const m = new ModelManager();
    const f = path.join(tmpDir, "big.bin");
    fs.writeFileSync(f, Buffer.alloc(95)); // 95 >= 0.9*100
    expect(m._verifyModel(f, { expected_size: 100 } as any)).toBe(true);
  });

  // 7. _verifyModel — 文件 size < 90% expected 返回 false
  it("_verifyModel returns false when file size < 90% of expected", () => {
    const m = new ModelManager();
    const f = path.join(tmpDir, "small.bin");
    fs.writeFileSync(f, Buffer.alloc(80)); // 80 < 90
    expect(m._verifyModel(f, { expected_size: 100 } as any)).toBe(false);
  });

  // 8. _verifyModel — statSync 异常返回 false（不抛）
  it("_verifyModel returns false (no throw) when statSync fails", () => {
    const m = new ModelManager();
    expect(
      m._verifyModel("/nonexistent/path", { expected_size: 100 } as any),
    ).toBe(false);
  });

  // 9. checkModelFiles — 缓存命中（2s 内）返回同一结果
  it("checkModelFiles caches result within GLOBAL_CACHE_TIME", async () => {
    const m = new ModelManager();
    m.getModelCachePath = () => path.join(tmpDir, "nope");
    const r1 = await m.checkModelFiles();
    const getPathSpy = vi.spyOn(m, "getModelCachePath");
    const r2 = await m.checkModelFiles();
    expect(r2).toBe(r1); // 同一对象引用
    expect(getPathSpy).not.toHaveBeenCalled();
  });

  // 10. checkModelFiles — minimum_ready 标志：必需模型缺失时为 false
  it("checkModelFiles sets minimum_ready false when required models missing", async () => {
    const m = new ModelManager();
    m.clearCache();
    m.getModelCachePath = () => tmpDir; // 空目录
    const r = await m.checkModelFiles();
    expect(r.minimum_ready).toBe(false);
    expect(r.missing_models).toContain("asr");
    expect(r.missing_models).toContain("vad");
  });

  // 11. checkModelFiles — 全部下载 → models_downloaded=true
  it("checkModelFiles sets models_downloaded true when all present and valid", async () => {
    const m = new ModelManager();
    m.clearCache();
    m.getModelCachePath = () => tmpDir;
    for (const cfg of Object.values<any>(m.modelConfigs)) {
      const d = path.join(tmpDir, cfg.cache_path);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "model.pt"), "x");
    }
    const r = await m.checkModelFiles();
    expect(r.models_downloaded).toBe(true);
    expect(r.missing_models).toEqual([]);
  });

  // 12. getDownloadProgress — 无缓存目录返回 0 进度
  it("getDownloadProgress returns 0 progress when cache missing", async () => {
    const m = new ModelManager();
    m.getModelCachePath = () => path.join(tmpDir, "missing");
    const p = await m.getDownloadProgress();
    expect(p.progress).toBe(0);
    expect(p.stage).toBe("waiting");
  });

  // 13. getDownloadProgress — 部分下载百分比封顶 100
  it("getDownloadProgress caps per-model percentage at 100", async () => {
    const m = new ModelManager();
    m.getModelCachePath = () => tmpDir;
    // 写一个超大文件（超过 expected_size）验证封顶
    const asr = m.modelConfigs.asr;
    const f = path.join(tmpDir, asr.cache_path);
    fs.writeFileSync(f, Buffer.alloc(asr.expected_size + 1000));
    const p = await m.getDownloadProgress();
    expect((p.models as any).asr.percentage).toBe(100);
  });

  // 14. findDamoRoot — 找到含 speech_paraformer 的 damo 目录
  it("findDamoRoot locates damo dir containing speech_paraformer subdir", () => {
    const m = new ModelManager();
    const root = path.join(tmpDir, "nested");
    const damo = path.join(root, "damo");
    fs.mkdirSync(path.join(damo, "speech_paraformer-xxx"), { recursive: true });
    expect(m.findDamoRoot(tmpDir)).toBe(damo);
  });

  // 15. findDamoRoot — damo 目录无 speech_paraformer 时跳过继续递归
  it("findDamoRoot skips damo dir without speech_paraformer and keeps searching", () => {
    const m = new ModelManager();
    const damoNoMatch = path.join(tmpDir, "a", "damo");
    fs.mkdirSync(damoNoMatch, { recursive: true }); // 空 damo
    const damoMatch = path.join(tmpDir, "b", "damo");
    fs.mkdirSync(path.join(damoMatch, "speech_paraformer-y"), {
      recursive: true,
    });
    expect(m.findDamoRoot(tmpDir)).toBe(damoMatch);
  });
});
```

**额外可测**：`getModelCachePath` 多候选探测逻辑（mock `fs.existsSync`/`readdirSync`）、`getDownloadScriptPath` dev/prod 分支、`downloadModels` 已下载短路返回 + spawn stdout JSON 解析分支。

---

### 2.7 pythonEnvironment.ts ★（惰性 require，可纯测大部分）

**现有测试**：0 个
**导出**：`export default PythonEnvironment`（类）
**electron 依赖**：方法内惰性 `require("electron")` 兜底（模式 B）
**依赖**：`PythonInstaller`, `runCommand`, `spawn`

**纯逻辑方法**：

- `isPythonVersionSupported(version)` — major=3 && minor>=8
- `clearFunASRInstallCache()` — 清缓存
- `buildPythonEnvironment()` — 环境变量构造（PYTHONUTF8/PATH/PYTHONHOME）+ 缓存
- `setupIsolatedEnvironment()` — 嵌入式 Python 存在性分支 + 环境变量设置
- `getFunASRServerPath()` / `getEmbeddedPythonPath()` — dev/prod 路径

**需 mock spawn**：`getPythonVersion`, `findPythonExecutable`, `findPythonExecutableWithFallback`, `checkFunASRInstallation`, `installFunASR`

**测试用例**（14 个）：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

describe("PythonEnvironment", () => {
  let PythonEnvironment: any;
  let tmpDir: string;
  beforeEach(() => {
    vi.resetModules();
    PythonEnvironment = require("../../src/helpers/pythonEnvironment").default;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pe-"));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // 1. isPythonVersionSupported — 3.8 通过
  it("isPythonVersionSupported accepts 3.8", () => {
    const m = new PythonEnvironment();
    expect(m.isPythonVersionSupported({ major: 3, minor: 8 })).toBe(true);
  });

  // 2. isPythonVersionSupported — 3.11 通过
  it("isPythonVersionSupported accepts 3.11", () => {
    expect(
      new PythonEnvironment().isPythonVersionSupported({ major: 3, minor: 11 }),
    ).toBe(true);
  });

  // 3. isPythonVersionSupported — 3.7 拒绝
  it("isPythonVersionSupported rejects 3.7", () => {
    expect(
      new PythonEnvironment().isPythonVersionSupported({ major: 3, minor: 7 }),
    ).toBe(false);
  });

  // 4. isPythonVersionSupported — 2.x 拒绝
  it("isPythonVersionSupported rejects Python 2", () => {
    expect(
      new PythonEnvironment().isPythonVersionSupported({ major: 2, minor: 7 }),
    ).toBe(false);
  });

  // 5. isPythonVersionSupported — null/undefined 拒绝
  it("isPythonVersionSupported rejects null/undefined", () => {
    const m = new PythonEnvironment();
    expect(m.isPythonVersionSupported(null)).toBe(false);
    expect(m.isPythonVersionSupported(undefined)).toBe(false);
  });

  // 6. clearFunASRInstallCache 清除已缓存结果
  it("clearFunASRInstallCache resets cached funasrInstalled", () => {
    const m = new PythonEnvironment();
    m.funasrInstalled = { installed: true, working: true };
    m.clearFunASRInstallCache();
    expect(m.funasrInstalled).toBeNull();
  });

  // 7. checkFunASRInstallation — 已缓存时直接返回不重新 spawn
  it("checkFunASRInstallation returns cache without spawning when funasrInstalled set", async () => {
    const m = new PythonEnvironment();
    m.funasrInstalled = { installed: true, working: true };
    const r = await m.checkFunASRInstallation();
    expect(r).toEqual({ installed: true, working: true });
  });

  // 8. buildPythonEnvironment — 强制设置 PYTHONUTF8=1
  it("buildPythonEnvironment forces PYTHONUTF8=1", () => {
    const m = new PythonEnvironment();
    m.getEmbeddedPythonPath = () => "/nonexistent";
    const env = m.buildPythonEnvironment();
    expect(env.PYTHONUTF8).toBe("1");
  });

  // 9. buildPythonEnvironment — 缓存：相同 embeddedCheck 第二次返回同一对象
  it("buildPythonEnvironment caches env for same embedded check result", () => {
    const m = new PythonEnvironment();
    m.getEmbeddedPythonPath = () => "/nonexistent";
    const e1 = m.buildPythonEnvironment();
    const e2 = m.buildPythonEnvironment();
    expect(e2).toBe(e1);
  });

  // 10. buildPythonEnvironment — 嵌入式存在时设置 PYTHONHOME/MPLBACKEND
  it("buildPythonEnvironment sets PYTHONHOME and MPLBACKEND when embedded exists", () => {
    const m = new PythonEnvironment();
    // 伪造嵌入式 python 路径结构
    const fakePy = path.join(tmpDir, "python", "bin", "python3.11");
    fs.mkdirSync(path.dirname(fakePy), { recursive: true });
    fs.writeFileSync(fakePy, "x");
    m.getEmbeddedPythonPath = () => fakePy;
    const env = m.buildPythonEnvironment();
    expect(env.PYTHONHOME).toBeDefined();
    expect(env.MPLBACKEND).toBe("Agg");
    expect(env.PATH).toContain(
      path.join(path.dirname(path.dirname(fakePy)), "bin"),
    );
  });

  // 11. setupIsolatedEnvironment — 嵌入式不存在时清除 PYTHONHOME/PYTHONPATH
  it("setupIsolatedEnvironment deletes PYTHONHOME/PYTHONPATH when embedded missing", () => {
    const m = new PythonEnvironment();
    m.getEmbeddedPythonPath = () => "/nonexistent";
    process.env.PYTHONHOME = "x";
    process.env.PYTHONPATH = "y";
    const r = m.setupIsolatedEnvironment();
    expect(r).toBe(false);
    expect(process.env.PYTHONHOME).toBeUndefined();
    expect(process.env.PYTHONPATH).toBeUndefined();
  });

  // 12. setupIsolatedEnvironment — 嵌入式存在时设置 PYTHONHOME/PYTHONPATH，返回 true
  it("setupIsolatedEnvironment sets vars and returns true when embedded exists", () => {
    const m = new PythonEnvironment();
    const fakePy = path.join(tmpDir, "python", "bin", "python3.11");
    const libDir = path.join(tmpDir, "python", "lib", "python3.11");
    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(path.dirname(fakePy), { recursive: true });
    fs.writeFileSync(fakePy, "x");
    m.getEmbeddedPythonPath = () => fakePy;
    const r = m.setupIsolatedEnvironment();
    expect(r).toBe(true);
    expect(process.env.PYTHONHOME).toContain("python");
    expect(process.env.PYTHONPATH).toContain("python3.11");
    delete process.env.PYTHONHOME;
    delete process.env.PYTHONPATH;
  });

  // 13. getFunASRServerPath — prod 路径
  it("getFunASRServerPath returns resourcesPath path in prod", () => {
    process.env.NODE_ENV = "production";
    const m = new PythonEnvironment();
    expect(m.getFunASRServerPath()).toBe(
      path.join(process.resourcesPath, "app.asar.unpacked", "funasr_server.py"),
    );
    process.env.NODE_ENV = "test";
  });

  // 14. getEmbeddedPythonPath — prod 路径
  it("getEmbeddedPythonPath returns prod path when not development", () => {
    process.env.NODE_ENV = "production";
    const m = new PythonEnvironment();
    expect(m.getEmbeddedPythonPath()).toBe(
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "python",
        "bin",
        "python3.11",
      ),
    );
    process.env.NODE_ENV = "test";
  });
});
```

**Mock 备注 — spawn 相关**：

- `getPythonVersion`：mock spawn 返回伪进程，触发 close=0 + stdout "Python 3.11.5" → 解析；close≠0 → null；error → null
- `findPythonExecutable`：缓存命中（pythonCmd 已设）；嵌入式存在 + 版本支持；嵌入式不存在 + 非 dev 抛错；dev 模式走 fallback
- `installFunASR`：pip 升级失败重试、"Permission denied" → --user 重试、"Microsoft Visual C++"/"No matching distribution" 错误消息映射

---

### 2.8 pythonInstaller.ts ★（无 electron！）

**现有测试**：0 个
**导出**：`export default PythonInstaller`（类）
**electron 依赖**：**无**（fs/path/https/os/runCommand）— 应从 coverage 排除列表移除

**纯逻辑/可 mock 方法**：

- 构造函数 — `pythonVersion = "3.11.9"`
- `checkWindowsAdmin()` — mock `runCommand` 成功/失败
- `installPython(callback)` — 平台分发（darwin/win32/linux/default）
- `isPythonInstalled()` — mock runCommand 遍历命令
- `downloadFile(url, path, cb)` — mock `https.get` + 流

**测试用例**（9 个）：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../../src/utils/process", () => ({
  runCommand: vi.fn(),
  TIMEOUTS: {
    QUICK_CHECK: 5000,
    PIP_UPGRADE: 60000,
    INSTALL: 300000,
    DOWNLOAD: 600000,
  },
}));
import { runCommand } from "../../src/utils/process";
import PythonInstaller from "../../src/helpers/pythonInstaller";

// 1. 构造函数 — pythonVersion = "3.11.9"
it("constructor sets pythonVersion to 3.11.9", () => {
  expect(new PythonInstaller().pythonVersion).toBe("3.11.9");
});

// 2. checkWindowsAdmin — runCommand 成功返回 true
it("checkWindowsAdmin returns true when reg query succeeds", async () => {
  (runCommand as any).mockResolvedValue({ output: "", code: 0 });
  const r = await new PythonInstaller().checkWindowsAdmin();
  expect(r).toBe(true);
  expect(runCommand).toHaveBeenCalledWith(
    "reg",
    ["query", "HKU\\S-1-5-19"],
    expect.anything(),
  );
});

// 3. checkWindowsAdmin — runCommand 失败返回 false
it("checkWindowsAdmin returns false when reg query fails", async () => {
  (runCommand as any).mockRejectedValue(new Error("access denied"));
  const r = await new PythonInstaller().checkWindowsAdmin();
  expect(r).toBe(false);
});

// 4. installPython — darwin 分发到 installPythonMacOS
it("installPython dispatches to installPythonMacOS on darwin", async () => {
  const orig = process.platform;
  Object.defineProperty(process, "platform", {
    value: "darwin",
    configurable: true,
  });
  const inst = new PythonInstaller();
  const spy = vi
    .spyOn(inst, "installPythonMacOS")
    .mockResolvedValue({ success: true, method: "brew" });
  await inst.installPython(null);
  expect(spy).toHaveBeenCalled();
  Object.defineProperty(process, "platform", {
    value: orig,
    configurable: true,
  });
});

// 5. installPython — win32 分发
it("installPython dispatches to installPythonWindows on win32", async () => {
  const orig = process.platform;
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  const inst = new PythonInstaller();
  const spy = vi
    .spyOn(inst, "installPythonWindows")
    .mockResolvedValue({ success: true, method: "x" });
  await inst.installPython(null);
  expect(spy).toHaveBeenCalled();
  Object.defineProperty(process, "platform", {
    value: orig,
    configurable: true,
  });
});

// 6. installPython — linux 分发
it("installPython dispatches to installPythonLinux on linux", async () => {
  const orig = process.platform;
  Object.defineProperty(process, "platform", {
    value: "linux",
    configurable: true,
  });
  const inst = new PythonInstaller();
  const spy = vi
    .spyOn(inst, "installPythonLinux")
    .mockResolvedValue({ success: true, method: "apt" });
  await inst.installPython(null);
  expect(spy).toHaveBeenCalled();
  Object.defineProperty(process, "platform", {
    value: orig,
    configurable: true,
  });
});

// 7. installPython — 进度回调被调用（stage + percentage）
it("installPython invokes progressCallback with stage/percentage", async () => {
  const orig = process.platform;
  Object.defineProperty(process, "platform", {
    value: "darwin",
    configurable: true,
  });
  const inst = new PythonInstaller();
  vi.spyOn(inst, "installPythonMacOS").mockImplementation(async (cb) => {
    cb && cb({ stage: "step", percentage: 5 });
    return { success: true, method: "brew" };
  });
  const cb = vi.fn();
  await inst.installPython(cb);
  // 第一个调用是 installPython 内部的 "开始 Python 安装..."
  expect(cb).toHaveBeenCalledWith(
    expect.objectContaining({ stage: "开始 Python 安装...", percentage: 5 }),
  );
  Object.defineProperty(process, "platform", {
    value: orig,
    configurable: true,
  });
});

// 8. isPythonInstalled — 第一个命令版本 >= 3.0 时返回 installed + command
it("isPythonInstalled returns installed when first cmd reports Python 3.x", async () => {
  (runCommand as any).mockResolvedValueOnce({
    output: "Python 3.11.5",
    code: 0,
  });
  const r = await new PythonInstaller().isPythonInstalled();
  expect(r.installed).toBe(true);
  expect(r.command).toBe("python3.11");
  expect(r.version).toBe(3.11);
});

// 9. isPythonInstalled — 所有命令失败返回 { installed: false }
it("isPythonInstalled returns installed:false when all commands fail", async () => {
  (runCommand as any).mockRejectedValue(new Error("not found"));
  const r = await new PythonInstaller().isPythonInstalled();
  expect(r.installed).toBe(false);
});
```

**Mock 备注 — install\* 子方法（mock runCommand + downloadFile）**：

- `installPythonMacOS`：brew 可用→brew install；不可用→downloadFile + sudo installer；错误清理 installerPath
- `installPythonWindows`：checkWindowsAdmin 分支决定 installArgs（InstallAllUsers/InstallLauncherAllUsers 不同）
- `installPythonLinux`：apt→yum→pacman 三级回退，全失败抛"未找到支持的包管理器"
- `downloadFile`：mock `https.get`，测 HTTP 非 200 拒绝、content-length 进度计算、stream error 清理

---

### 2.9 updateManager.ts

**现有测试**：8 个（`updateManager-behavioral.test.ts` 测 semverGt/parseChecksums/getPlatformAsset）
**导出**：命名导出 `semverGt`, `getPlatformAsset`, `getChecksumsAsset`, `parseChecksums`, `verifySHA256`, `register`
**electron 依赖**：顶层 `import { app, shell, net, BrowserWindow, Notification } from "electron"`（模式 A）

**纯逻辑方法**（已部分覆盖）：

- `semverGt(a, b)` — 已有 4 测试
- `parseChecksums(content)` — 已有 2 测试
- `getPlatformAsset` — 已有 2 测试
- `getChecksumsAsset(release)` — **未测**
- `verifySHA256(filePath, expectedHash)` — **未测**（安全关键！）

**需 mock electron + fs**：`register`（ipcMain.handle 4 个通道）

**新增测试用例**（10 个）：

```ts
vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "1.0.0"),
    getPath: vi.fn(() => "/tmp"),
    quit: vi.fn(),
  },
  shell: { openPath: vi.fn() },
  net: { fetch: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  Notification: { isSupported: vi.fn(() => false) },
}));
import {
  semverGt,
  getPlatformAsset,
  getChecksumsAsset,
  parseChecksums,
  verifySHA256,
} from "../../src/helpers/updateManager";

describe("getChecksumsAsset", () => {
  // 1. 找到 checksums-sha256.txt
  it("returns the checksums asset when present", () => {
    const release = {
      assets: [
        { name: "Murmur-1.0.0.dmg", browser_download_url: "u1" },
        { name: "checksums-sha256.txt", browser_download_url: "u2" },
      ],
    } as any;
    expect(getChecksumsAsset(release)?.browser_download_url).toBe("u2");
  });

  // 2. 无 checksums 资产返回 undefined
  it("returns undefined when no checksums asset", () => {
    const release = { assets: [{ name: "x.dmg" }] } as any;
    expect(getChecksumsAsset(release)).toBeUndefined();
  });

  // 3. assets 缺失时不抛（空数组兜底）
  it("handles missing assets array without throwing", () => {
    expect(getChecksumsAsset({} as any)).toBeUndefined();
  });
});

describe("parseChecksums — edge cases", () => {
  // 4. 单空格分隔（不匹配 \s{2,}）→ filename 为空
  it("treats single-space-separated line as hash-only (filename empty)", () => {
    const sha = "a".repeat(64);
    const entries = parseChecksums(`${sha} Murmur-1.0.0.dmg`); // 单空格
    expect(entries[0].hash).toBe(sha);
    expect(entries[0].filename).toBe(""); // 单空格不匹配 \s{2,}
  });

  // 5. 多个空格/tab 分隔正确解析
  it("parses lines separated by 2+ spaces or tabs", () => {
    const sha = "b".repeat(64);
    const entries = parseChecksums(`${sha}\t\tMurmur-1.0.0.exe`);
    expect(entries[0].filename).toBe("Murmur-1.0.0.exe");
  });
});

describe("semverGt — edge cases", () => {
  // 6. 两段版本号（缺第三段按 0）
  it("treats missing segments as 0 (1.2 vs 1.2.0)", () => {
    expect(semverGt("1.2", "1.2.0")).toBe(false);
    expect(semverGt("1.2.1", "1.2")).toBe(true);
  });

  // 7. 非数字段按 NaN→0 处理（1.x.0 vs 1.0.0）
  it("treats non-numeric segments as NaN (0 in comparison)", () => {
    // "x".map → NaN，Number(NaN) || 0 = 0；所以 1.x.0 == 1.0.0
    expect(semverGt("1.x.0", "1.0.0")).toBe(false);
  });
});

describe("verifySHA256", () => {
  // 8. 文件 hash 匹配返回 true（不区分大小写）
  it("returns true when file hash matches expected (case-insensitive)", async () => {
    const crypto = require("crypto");
    const content = "hello world";
    const expected = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex")
      .toUpperCase();
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const f = path.join(os.tmpdir(), `v-${Date.now()}.txt`);
    fs.writeFileSync(f, content);
    try {
      await expect(verifySHA256(f, expected)).resolves.toBe(true);
    } finally {
      fs.unlinkSync(f);
    }
  });

  // 9. 文件 hash 不匹配返回 false
  it("returns false when file hash does not match", async () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const f = path.join(os.tmpdir(), `v2-${Date.now()}.txt`);
    fs.writeFileSync(f, "different content");
    try {
      await expect(verifySHA256(f, "0".repeat(64))).resolves.toBe(false);
    } finally {
      fs.unlinkSync(f);
    }
  });

  // 10. 文件读取错误时 reject
  it("rejects when file cannot be read", async () => {
    await expect(
      verifySHA256("/nonexistent/file.bin", "0".repeat(64)),
    ).rejects.toThrow();
  });
});
```

**Mock 备注 — register() IPC 测试（安全关键，强烈建议补）**：

- mock `ipcMain.handle` 捕获处理器，mock `net.fetch` 返回伪 Response
- `UPDATE.CHECK`：response.ok=false → error；tag_name 非字符串 → 格式异常；正常 → hasUpdate + downloadUrl
- `UPDATE.DOWNLOAD`：已有下载 → "已有下载进行中"；缺字段 → "缺少下载信息"；checksums 无匹配 → "校验文件中未找到"；SHA256 失败 → 删文件 + "SHA256 校验失败"
- `UPDATE.INSTALL`（**路径逃逸守卫**）：路径不在 temp → 返回 false + warn；在 temp → shell.openPath + app.quit
- `UPDATE.CANCEL`：无下载 → "没有进行中的下载"；有 → cancelled=true

---

### 2.10 environment.ts ★（无 electron！）

**现有测试**：0 个 manager 测试（仅 `environmentHandlers.test.js` 测 IPC）
**导出**：`export default EnvironmentManager`（类）
**electron 依赖**：**无**（path/fs/os + 惰性 `require("dotenv")`）— 应从 coverage 排除列表移除

**全部纯逻辑方法**（这是最容易测的 manager）：

- `getAIConfig()`, `getAudioConfig()`, `getFunASRConfig()`, `getAppConfig()`, `getDatabaseConfig()`, `getProxyConfig()`, `getPerformanceConfig()` — 环境变量读取 + 默认值
- `getSystemInfo()` — os 聚合
- `isDevelopment()`, `isProduction()` — NODE_ENV 判断
- `getDataDirectory()` — 三平台分支
- `validateEnvironment()` — Node 版本检查 + 目录创建

**测试用例**（16 个）：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import EnvironmentManager from "../../src/helpers/environment";

describe("EnvironmentManager config readers", () => {
  let origEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    origEnv = { ...process.env };
  });
  afterEach(() => {
    process.env = origEnv;
  });

  // 1. getAIConfig — 固定默认值
  it("getAIConfig returns hardcoded defaults", () => {
    const c = new EnvironmentManager().getAIConfig();
    expect(c.apiKey).toBe("");
    expect(c.baseURL).toBe("https://api.openai.com/v1");
    expect(c.model).toBe("gpt-3.5-turbo");
  });

  // 2. getAudioConfig — 默认 16000/1/wav
  it("getAudioConfig returns 16000/1/wav defaults", () => {
    const c = new EnvironmentManager().getAudioConfig();
    expect(c.sampleRate).toBe(16000);
    expect(c.channels).toBe(1);
    expect(c.format).toBe("wav");
  });

  // 3. getAudioConfig — 环境变量覆盖
  it("getAudioConfig honors AUDIO_SAMPLE_RATE/AUDIO_CHANNELS/AUDIO_FORMAT", () => {
    process.env.AUDIO_SAMPLE_RATE = "44100";
    process.env.AUDIO_CHANNELS = "2";
    process.env.AUDIO_FORMAT = "mp3";
    const c = new EnvironmentManager().getAudioConfig();
    expect(c.sampleRate).toBe(44100);
    expect(c.channels).toBe(2);
    expect(c.format).toBe("mp3");
  });

  // 4. getFunASRConfig — hotwords 逗号分隔
  it("getFunASRConfig splits HOTWORDS by comma", () => {
    process.env.HOTWORDS = "a,b,c";
    const c = new EnvironmentManager().getFunASRConfig();
    expect(c.hotwords).toEqual(["a", "b", "c"]);
  });

  // 5. getFunASRConfig — 无 HOTWORDS 返回空数组
  it("getFunASRConfig returns empty hotwords when env unset", () => {
    delete process.env.HOTWORDS;
    expect(new EnvironmentManager().getFunASRConfig().hotwords).toEqual([]);
  });

  // 6. getAppConfig — DEBUG=true 设置 debug
  it("getAppConfig sets debug when DEBUG=true", () => {
    process.env.DEBUG = "true";
    expect(new EnvironmentManager().getAppConfig().debug).toBe(true);
  });

  // 7. getAppConfig — 默认 globalHotkey
  it("getAppConfig default globalHotkey is Cmd+Shift+Space", () => {
    delete process.env.GLOBAL_HOTKEY;
    expect(new EnvironmentManager().getAppConfig().globalHotkey).toBe(
      "CommandOrControl+Shift+Space",
    );
  });

  // 8. getDatabaseConfig — BACKUP_ENABLED=false 关闭
  it("getDatabaseConfig disables backup when BACKUP_ENABLED=false", () => {
    process.env.BACKUP_ENABLED = "false";
    expect(new EnvironmentManager().getDatabaseConfig().backupEnabled).toBe(
      false,
    );
  });

  // 9. getDatabaseConfig — 默认开启备份
  it("getDatabaseConfig enables backup by default", () => {
    delete process.env.BACKUP_ENABLED;
    expect(new EnvironmentManager().getDatabaseConfig().backupEnabled).toBe(
      true,
    );
  });

  // 10. getProxyConfig — 默认空字符串
  it("getProxyConfig returns empty strings by default", () => {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    const c = new EnvironmentManager().getProxyConfig();
    expect(c.http).toBe("");
    expect(c.https).toBe("");
  });

  // 11. getPerformanceConfig — 默认 300/10000
  it("getPerformanceConfig returns 300/10000 defaults", () => {
    const c = new EnvironmentManager().getPerformanceConfig();
    expect(c.maxRecordingDuration).toBe(300);
    expect(c.maxTextLength).toBe(10000);
  });

  // 12. isDevelopment / isProduction
  it("isDevelopment/isProduction read NODE_ENV", () => {
    process.env.NODE_ENV = "development";
    const m = new EnvironmentManager();
    expect(m.isDevelopment()).toBe(true);
    expect(m.isProduction()).toBe(false);
    process.env.NODE_ENV = "production";
    expect(m.isProduction()).toBe(true);
  });
});

describe("EnvironmentManager paths", () => {
  // 13. getDataDirectory — darwin 分支
  it("getDataDirectory returns macOS path on darwin", () => {
    const orig = process.platform;
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    const p = new EnvironmentManager().getDataDirectory();
    expect(p).toContain("Library/Application Support/Murmur");
    Object.defineProperty(process, "platform", {
      value: orig,
      configurable: true,
    });
  });

  // 14. getDataDirectory — win32 分支
  it("getDataDirectory returns Windows path on win32", () => {
    const orig = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    const p = new EnvironmentManager().getDataDirectory();
    expect(p).toContain("AppData/Roaming/Murmur");
    Object.defineProperty(process, "platform", {
      value: orig,
      configurable: true,
    });
  });

  // 15. getDataDirectory — linux 分支
  it("getDataDirectory returns Linux path on linux", () => {
    const orig = process.platform;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    const p = new EnvironmentManager().getDataDirectory();
    expect(p).toContain(".config/Murmur");
    Object.defineProperty(process, "platform", {
      value: orig,
      configurable: true,
    });
  });

  // 16. validateEnvironment — Node 版本检查
  it("validateEnvironment flags Node version below 18", () => {
    // 模拟低版本：覆盖 process.version 不现实，改测 valid 字段始终为布尔
    const r = new EnvironmentManager().validateEnvironment();
    expect(typeof r.valid).toBe("boolean");
    expect(Array.isArray(r.issues)).toBe(true);
    expect(r.systemInfo).toBeDefined();
  });
});
```

**额外可测**：`exportConfig()` 聚合所有 config、`ensureDataDirectory/getLogDirectory/getCacheDirectory/getModelsDirectory` 真实创建临时目录（mock `os.homedir` 到 tmpdir）。

---

### 2.11 logManager.ts ★（惰性 require，已有 9 测试）

**现有测试**：9 个（`logManager.test.js`，已 mock electron + tmpdir 注入）
**导出**：`export default LogManager`（类）
**electron 依赖**：`getLogDirectory()` 和 `getSystemInfo()` 内惰性 `require("electron")` 兜底（模式 B）

**已覆盖**：info/error 写文件、logFunASR 分流、getRecentLogs 解析/空/畸形、cleanOldLogs 删除/保留、getLogFilePath

**未覆盖缺口**（4 个）：

```ts
// 复用 logManager.test.js 的 mock + createManager 模式

// 1. warn/debug 方法分流到对应 level
it("warn writes level=warn, debug writes level=debug", () => {
  const mgr = createManager();
  mgr.warn("w");
  mgr.debug("d");
  const lines = fs.readFileSync(mgr.logFile, "utf8").trim().split("\n");
  expect(JSON.parse(lines[0]).level).toBe("warn");
  expect(JSON.parse(lines[1]).level).toBe("debug");
});

// 2. logFunASRLogs — 分离文件读取 + 畸形行兜底
it("getFunASRLogs parses funasr log file with malformed fallback", () => {
  const mgr = createManager();
  fs.appendFileSync(mgr.funasrLogFile, "not json\n");
  fs.appendFileSync(
    mgr.funasrLogFile,
    JSON.stringify({ message: "ok", timestamp: "t" }) + "\n",
  );
  const logs = mgr.getFunASRLogs();
  expect(logs).toHaveLength(2);
  expect(logs[0].message).toBe("not json");
});

// 3. getFunASRLogs — 文件不存在返回空数组
it("getFunASRLogs returns empty array when file missing", () => {
  const mgr = createManager();
  mgr.funasrLogFile = "/nonexistent/funasr.log";
  expect(mgr.getFunASRLogs()).toEqual([]);
});

// 4. getFunASRLogFilePath 返回配置路径
it("getFunASRLogFilePath returns configured path", () => {
  const mgr = createManager();
  expect(mgr.getFunASRLogFilePath()).toBe(path.join(tmpDir, "funasr.log"));
});
```

**额外可测**：`cleanOldLogs` 默认 7 天参数、`getLogDirectory` 在 electron 不可用时落 `os.tmpdir()/murmur-logs`（已隐式覆盖）。

---

### 2.12 funasrManager.ts ★（无 electron！委派层）

**现有测试**：2 个（`funasrManager-init-race.test.js`）
**导出**：`export default FunASRManager`（类）
**electron 依赖**：**无**（委派给 PythonEnvironment/ModelManager/FunASRServer）
**依赖**：构造 3 个子 manager（这些子 manager 才有惰性 require electron，但 funasrManager 自身可加载）

**纯委派方法**（可测委派正确性）：

- 所有 getter（pythonCmd/funasrInstalled/modelsInitialized/serverReady/modelsDownloaded/initializationPromise）
- 委派方法（getFunASRServerPath/getEmbeddedPythonPath/setupIsolatedEnvironment/buildPythonEnvironment/findPythonExecutable/checkPythonInstallation/installPython/checkFunASRInstallation/installFunASR/getModelCachePath/checkModelFiles/getDownloadProgress/transcribeAudio/transcribeFile/diarizeAudio/cancelTranscription/gracefulShutdown）

**编排方法**（已有部分测试）：

- `restartServer()` — 串联多个子方法
- `initializeAtStartup()` — 异常容错
- `preInitializeModels()` — 已有 2 测试
- `checkStatus()` — 状态聚合

**测试用例**（8 个）：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import FunASRManager from "../../src/helpers/funasrManager";

describe("FunASRManager delegation", () => {
  let m: any;
  beforeEach(() => {
    m = new FunASRManager({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  });

  // 1. pythonCmd getter 委派给 pythonEnv
  it("pythonCmd getter delegates to pythonEnv", () => {
    m.pythonEnv.pythonCmd = "/usr/bin/python3";
    expect(m.pythonCmd).toBe("/usr/bin/python3");
  });

  // 2. pythonCmd setter 写入 pythonEnv
  it("pythonCmd setter writes to pythonEnv", () => {
    m.pythonCmd = "/new/python";
    expect(m.pythonEnv.pythonCmd).toBe("/new/python");
  });

  // 3. modelsInitialized getter 委派
  it("modelsInitialized getter delegates to server", () => {
    m.server.modelsInitialized = true;
    expect(m.modelsInitialized).toBe(true);
  });

  // 4. serverReady getter 委派
  it("serverReady getter delegates to server", () => {
    m.server.serverReady = true;
    expect(m.serverReady).toBe(true);
  });

  // 5. modelsDownloaded getter 委派
  it("modelsDownloaded getter delegates to modelManager", () => {
    m.modelManager.modelsDownloaded = true;
    expect(m.modelsDownloaded).toBe(true);
  });

  // 6. 委派方法正确转发（以 checkFunASRInstallation 为例）
  it("checkFunASRInstallation delegates to pythonEnv", async () => {
    const spy = vi.fn(async () => ({ installed: true }));
    m.pythonEnv.checkFunASRInstallation = spy;
    const r = await m.checkFunASRInstallation();
    expect(spy).toHaveBeenCalled();
    expect(r).toEqual({ installed: true });
  });

  // 7. gracefulShutdown 委派到 server
  it("gracefulShutdown delegates to server", async () => {
    const spy = vi.fn(async () => undefined);
    m.server.gracefulShutdown = spy;
    await m.gracefulShutdown();
    expect(spy).toHaveBeenCalled();
  });

  // 8. initializeAtStartup — 失败时仍调用 preInitializeModels 且不抛
  it("initializeAtStartup swallows errors and still pre-initializes", async () => {
    m.findPythonExecutable = vi.fn(async () => {
      throw new Error("no python");
    });
    const preSpy = vi.fn(async () => null);
    m.preInitializeModels = preSpy;
    await expect(m.initializeAtStartup()).resolves.toBeUndefined();
    expect(preSpy).toHaveBeenCalled();
    expect(m.isInitialized).toBe(false); // 异常路径未设 true
  });
});
```

**Mock 备注 — checkStatus 编排测试**（高价值）：

- serverReady=true → 走 `_sendServerCommand({action:"status"})` 分支
- serverReady=false + funasr 未装 → error="FunASR未安装"
- serverReady=false + funasr 装了 + 模型未下 → error="模型文件未下载..."
- serverReady=false + funasr 装了 + 模型就绪 → error="FunASR服务器正在启动中..."
- 整体 try/catch → 返回 `{success:false, error: e.message}`

---

## 3. 汇总：可测行为计数

| 文件                 | 现有   | 本文档新增                  | 累计         | 难度  |
| -------------------- | ------ | --------------------------- | ------------ | ----- |
| clipboard.ts         | 0      | 12 (+8 mock-heavy)          | 12-20        | 中    |
| hotkeyManager.ts     | 0      | 14 (+2)                     | 14-16        | 低    |
| tray.ts              | 0      | 8 (+4)                      | 8-12         | 低    |
| windowManager.ts     | 7      | 7 (+5)                      | 14-19        | 中    |
| funasrServer.ts      | 5      | 18 (+8)                     | 23-31        | 低★   |
| modelManager.ts      | 3      | 15 (+4)                     | 18-22        | 低    |
| pythonEnvironment.ts | 0      | 14 (+6)                     | 14-20        | 低    |
| pythonInstaller.ts   | 0      | 9 (+6)                      | 9-15         | 低★   |
| updateManager.ts     | 8      | 10 (+6 IPC)                 | 18-24        | 中    |
| environment.ts       | 0      | 16 (+4)                     | 16-20        | 极低★ |
| logManager.ts        | 9      | 4                           | 13           | 极低  |
| funasrManager.ts     | 2      | 8 (+5 编排)                 | 10-15        | 低★   |
| **合计**             | **34** | **135 (核心) + ~58 (扩展)** | **~169-227** |       |

**核心新增测试（本文档明确写出的）：135 个**（远超 80 目标）
**含 Electron-dependent mock 测试的总潜力：~193 个**

---

## 4. 实施优先级建议

### P0 — 立即从 coverage 排除列表移除（C 类，零成本）

修改 `vitest.config.ts` 的 `coverage.exclude`，删除以下 4 行：

```diff
- "src/helpers/funasrServer.ts",
- "src/helpers/pythonInstaller.ts",
- "src/helpers/environment.ts",
- "src/helpers/funasrManager.ts",
```

这 4 个文件**不导入 electron**，被排除是历史遗留（可能因"manager 整体排除"策略）。移除后现有/新增测试立即计入覆盖率。

### P1 — 最高 ROI（纯逻辑，零 mock）

1. **environment.ts**（16 测试，极低难度）— 纯环境变量读取
2. **pythonInstaller.ts**（9 测试，低难度）— 仅 mock runCommand
3. **funasrServer.ts calculateTranscriptionTimeout**（6 测试，零 mock）— 纯函数
4. **hotkeyManager.ts 纯逻辑**（9 测试）— F2 双击 + 状态
5. **modelManager.ts \_verifyModel/findDamoRoot**（8 测试）— 文件系统纯逻辑

### P2 — 安全关键 + 中等 mock

6. **updateManager.ts verifySHA256/getChecksumsAsset**（4 测试）— 安全关键
7. **clipboard.ts safeLog/copy/read/write**（8 测试）— mock clipboard
8. **tray.ts setStatus/getTrayIconPath**（6 测试）— 纯 switch

### P3 — 编排逻辑 + 完整覆盖

9. **funasrManager.ts 委派 + checkStatus**（10 测试）
10. **pythonEnvironment.ts 版本/环境构造**（10 测试）
11. **logManager.ts 补缺**（4 测试）
12. **windowManager.ts CSP 补缺**（5 测试）

### P4 — Electron-dependent 深度测试（mock 重，建议最后）

13. updateManager.ts `register()` IPC 4 通道（~8 测试，含路径逃逸守卫）
14. clipboard.ts paste\* 三平台 + spawn 超时/错误（~8 测试）
15. funasrServer.ts `_startFunASRServer` 完整 spawn 生命周期（~8 测试）

---

## 5. 关键风险与注意事项

1. **`tests/_tsresolve.setup.js` 已删除**（2026-07-26 Tier 3.2）：所有 `.js` 测试已迁移到 `.ts`，所有 `require()` 已转换为 ESM `import`。新测试直接用 `.ts` + `import`，无需任何 monkey-patch。

2. **模块级状态重置**（已过时）：`modelManager.ts` 有 `globalModelCheckCache`/`globalModelCheckTime` 模块级变量。测试现在用 ESM `import` + `vi.doMock()` 隔离（Tier 3.2 已删除 `vi.resetModules() + require()` 模式）。

3. **平台 mock 不可逆风险**：`Object.defineProperty(process, "platform", ...)` 必须在 `afterEach`/finally 还原，否则污染同进程后续测试。推荐用 `vi.stubGlobal` 或单独的 helper。

4. **`vi.mock("electron")` 必须顶层**：Vitest hoists `vi.mock` 调用；不能放在 `beforeEach` 内。模式 A 文件必须在 `import` 前声明 mock。

5. **funasrServer.ts 命名导出**：`calculateTranscriptionTimeout` 是命名导出 + static 方法双暴露。测试导入用 `import { calculateTranscriptionTimeout }`（命名），不要通过 default 实例（除非验证 static 挂载）。

6. **coverage 阈值影响**：当前阈值 stmts=94/branches=88。移除 4 个 C 类文件 + 新增 135 测试后，分母增大、分子（覆盖行）大幅增加，应能轻松达标并可能允许提升阈值。
