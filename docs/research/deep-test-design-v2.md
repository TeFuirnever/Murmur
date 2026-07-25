# Murmur 深度测试设计 v2 — 从客户端启动到功能回归

> 状态：第二版（基于 Ralph 完成 57 个新测试后的代码库状态）
> 日期：2026-07-25
> 目标：每个测试都可执行、可验证、有精确的 mock setup 和断言

## 0. 当前基线（Ralph 后）

| 指标              | 值                                 |
| ----------------- | ---------------------------------- |
| 单元测试          | 731（71 文件）全部通过             |
| E2E 测试          | 39（11 suites）本地 16 pass，CI 0  |
| 覆盖率 Statements | 96.53%                             |
| 覆盖率 Branches   | 74.93%（阈值 88%，**未达标**）     |
| 覆盖率 Functions  | 94.54%（阈值 95%，**未达标**）     |
| Coverage 排除     | 12 manager + ipc/ 目录（~3800 行） |

## 1. 覆盖率瓶颈精确分析

### 1.1 Branch 覆盖率 < 80% 的文件（阈值阻塞）

| 文件                    | Branch% | 未覆盖行          | 问题                                          |
| ----------------------- | ------- | ----------------- | --------------------------------------------- |
| `fileConfig.ts`         | 63.63%  | 27-49             | `loadFileConfig` 的文件不存在/损坏/非对象路径 |
| `database.ts`           | 67.18%  | 346-347, 357, 458 | segments JSON 解析失败、getSetting 解密路径   |
| `audioPathValidator.ts` | 75%     | 31                | 不支持扩展名的错误消息分支                    |
| `exportFormatters.ts`   | 75%     | 350               | 格式选择 fallback 分支                        |
| `ipcRateLimiter.ts`     | 77.77%  | 29, 41, 45        | 窗口清理 + 限流触发 + handler 透传            |
| `aiPrompts.ts`          | 78.57%  | 72                | 模板解析的某个分支                            |
| `asrEngine.ts`          | 77.77%  | 44-58, 84         | 引擎注册/查找的 fallback 分支                 |

### 1.2 Function 覆盖率 < 90% 的文件

| 文件                 | Func%  | 未覆盖行 | 问题                                     |
| -------------------- | ------ | -------- | ---------------------------------------- |
| `providerPresets.ts` | 33.33% | 139      | `getProviderByName` 未测试               |
| `ipcRateLimiter.ts`  | 50%    | 29       | 返回的 `rateLimitedHandler` 未被实际调用 |

### 1.3 完全排除覆盖的 12 个 Manager（~3800 行）

这些文件因 import electron 被排除。但其中很多有**纯逻辑方法**可以测试。

**分类**（按可测试性）：

| Manager                | LOC  | 纯逻辑方法                                   | 可 mock electron 方法  | 当前测试           |
| ---------------------- | ---- | -------------------------------------------- | ---------------------- | ------------------ |
| `logManager.ts`        | ~230 | 日志格式化、文件轮转                         | 日志路径 (app.getPath) | 9 tests (excluded) |
| `environment.ts`       | ~290 | 配置读取、env 构建                           | dotenv lazy require    | 仅模块解析         |
| `modelManager.ts`      | ~360 | checkModelFiles, \_verifyModel, findDamoRoot | app.getPath (lazy)     | 3 tests (shape)    |
| `funasrServer.ts`      | ~450 | 计算转录超时、消息路由                       | spawn (mock)           | 5 tests (crash)    |
| `pythonEnvironment.ts` | ~360 | 版本检查、env 构建、Python 查找              | app.getPath (lazy)     | 0 behavioral       |
| `pythonInstaller.ts`   | ~370 | pip 命令构建、安装验证                       | spawn (mock)           | 0                  |
| `updateManager.ts`     | ~270 | semverGt, parseChecksums, getPlatformAsset   | electron-updater       | 8 behavioral (新)  |
| `windowManager.ts`     | ~260 | alwaysOnTop 管理                             | BrowserWindow          | 7 tests (events)   |
| `hotkeyManager.ts`     | ~200 | 快捷键格式解析、去抖动                       | globalShortcut         | 0                  |
| `tray.ts`              | ~150 | 菜单模板构建                                 | Tray, Menu             | 0                  |
| `clipboard.ts`         | ~440 | pasteWindows/pasteLinux 命令构建             | clipboard, osascript   | 0                  |
| `funasrManager.ts`     | ~230 | 初始化竞态控制                               | 无（协调器）           | 2 tests (race)     |

## 2. 业界最佳实践（Electron 测试金字塔）

来源：[Electron 官方文档](https://electronjs.org/docs/latest/tutorial/automated-testing)、[Emad Ibrahim 的 Electron 测试指南](https://emadibrahim.com/electron-guide/testing)、[Vitest GitHub Issue #4166](https://github.com/vitest-dev/vitest/issues/4166)

### 2.1 推荐比例

| 层级        | 占比 | Murmur 目标                          |
| ----------- | ---- | ------------------------------------ |
| Unit        | 80%  | ~600 tests（纯逻辑 + mock electron） |
| Integration | 15%  | ~100 tests（IPC 契约 + 模块交互）    |
| E2E         | 5%   | ~40 tests（关键用户旅程）            |

### 2.2 vitest mock electron 的关键限制

**`vi.mock("electron")` 只拦截 ESM `import`，不拦截 CJS `require()`。**

- Murmur 的 `.ts` 源文件用 `import { app } from "electron"` → `vi.mock` **有效**
- 但 `.ts` 源文件里的 `require("electron")`（lazy require）→ `vi.mock` **无效**
- 解决方案：对 CJS require，使用 `Module._resolveFilename` monkey-patch（参见 `windowManager-events.test.js`）

### 2.3 IPC 契约测试模式

**业界推荐**：将 handler 逻辑从 IPC 注册中提取为独立可测函数。

```typescript
// 坏：handler 逻辑内联在 ipcMain.handle 里
ipcMain.handle("save-transcription", (event, data) => {
  // 50 行验证 + 保存逻辑
});

// 好：提取为独立函数
export async function handleSaveTranscription(data, db) {
  if (!data || typeof data !== "object") throw new Error("Invalid input");
  return db.saveTranscription(data);
}

ipcMain.handle("save-transcription", (event, data) => {
  return handleSaveTranscription(data, databaseManager);
});
```

**Murmur 现状**：大部分 handler 是内联的。US-002 的 transcriptionHandlers 测试通过 mock ipcMain 记录注册来测试，绕过了这个问题。

## 3. Unit 测试设计 — 覆盖率瓶颈修复（P0，~40 tests）

### 3.1 fileConfig.ts（+8 tests → branch 63%→90%）

```typescript
describe("loadFileConfig", () => {
  it("returns empty object when file does not exist", () => {
    const result = loadFileConfig("/nonexistent/config.json");
    expect(result).toEqual({});
  });

  it("returns empty object when file is invalid JSON", () => {
    const tmpFile = createTempFile("{ invalid json }");
    const result = loadFileConfig(tmpFile);
    expect(result).toEqual({});
  });

  it("returns empty object when parsed value is array not object", () => {
    const tmpFile = createTempFile("[1,2,3]");
    const result = loadFileConfig(tmpFile);
    expect(result).toEqual({});
  });

  it("returns empty object when parsed value is null", () => {
    const tmpFile = createTempFile("null");
    const result = loadFileConfig(tmpFile);
    expect(result).toEqual({});
  });

  it("filters keys to only FILE_CONFIGURABLE_KEYS", () => {
    const tmpFile = createTempFile(
      JSON.stringify({
        "funasr.hotwords": "test",
        "invalid.key": "should be filtered",
      }),
    );
    const result = loadFileConfig(tmpFile);
    expect(result).toHaveProperty("funasr.hotwords");
    expect(result).not.toHaveProperty("invalid.key");
  });

  it("preserves all FILE_CONFIGURABLE_KEYS values", () => {
    const config = {};
    for (const key of FILE_CONFIGURABLE_KEYS) config[key] = "test";
    const tmpFile = createTempFile(JSON.stringify(config));
    const result = loadFileConfig(tmpFile);
    for (const key of FILE_CONFIGURABLE_KEYS) {
      expect(result[key]).toBe("test");
    }
  });
});

describe("saveFileConfig", () => {
  it("filters keys when saving", () => {
    const tmpFile = createTempPath();
    saveFileConfig(tmpFile, { "funasr.hotwords": "ok", "bad.key": "no" });
    const saved = JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
    expect(saved).toHaveProperty("funasr.hotwords");
    expect(saved).not.toHaveProperty("bad.key");
  });
});
```

### 3.2 database.ts（+12 tests → branch 67%→85%）

```typescript
describe("DatabaseManager — error path coverage", () => {
  it("getTranscriptionWithSegments returns parsedSegments on valid JSON", () => {
    db.saveTranscription({ text: "test", segments: '[{"start":0}]' });
    const id = db.saveTranscription({
      text: "test",
      segments: '[{"start":0}]',
    }).lastInsertRowid;
    const row = db.getTranscriptionWithSegments(Number(id));
    expect(row.parsedSegments).toEqual([{ start: 0 }]);
  });

  it("getTranscriptionWithSegments returns [] on corrupt segments JSON", () => {
    const id = db.saveTranscription({
      text: "test",
      segments: "corrupt{json",
    }).lastInsertRowid;
    const row = db.getTranscriptionWithSegments(Number(id));
    expect(row.parsedSegments).toEqual([]);
  });

  it("getTranscriptionWithSegments returns [] when segments is null", () => {
    const id = db.saveTranscription({ text: "test" }).lastInsertRowid;
    const row = db.getTranscriptionWithSegments(Number(id));
    expect(row.parsedSegments).toEqual([]);
  });

  it("getSetting returns defaultValue for non-existent key", () => {
    const result = db.getSetting("nonexistent", "default");
    expect(result).toBe("default");
  });

  it("getSetting decrypts encrypted keys when safeStorage available", () => {
    db.setSafeStorage(mockSafeStorage);
    db.setSetting("ai_api_key", "secret");
    const result = db.getSetting("ai_api_key", "");
    expect(result).toBe("secret");
  });

  it("getSetting returns defaultValue when decryption fails", () => {
    db.setSafeStorage({
      ...mockSafeStorage,
      decryptString: () => {
        throw new Error("decrypt failed");
      },
    });
    db.setSetting("ai_api_key", "secret"); // saves encrypted
    const result = db.getSetting("ai_api_key", "fallback");
    expect(result).toBe("fallback");
  });

  it("getSetting returns plaintext for non-encrypted keys", () => {
    db.setSetting("model_path", "/some/path");
    const result = db.getSetting("model_path", "");
    expect(result).toBe("/some/path");
  });

  // ... 5 more error path tests
});
```

### 3.3 providerPresets.ts（+2 tests → function 33%→100%）

```typescript
describe("getProviderByName", () => {
  it("returns preset by name when found", () => {
    const result = getProviderByName("openai");
    expect(result).toBeDefined();
    expect(result?.name).toBe("openai");
  });

  it("returns undefined for unknown provider name", () => {
    const result = getProviderByName("nonexistent");
    expect(result).toBeUndefined();
  });
});
```

### 3.4 ipcRateLimiter.ts（+3 tests → function 50%→100%, branch 78%→100%）

```typescript
describe("rateLimitedHandler — actual execution", () => {
  it("calls handler and returns result within rate limit", async () => {
    const handler = vi.fn(async () => "result");
    const limited = createRateLimitedHandler(handler, {
      maxCalls: 3,
      windowMs: 1000,
    });
    const result = await limited({}, "arg1");
    expect(result).toBe("result");
    expect(handler).toHaveBeenCalledWith({}, "arg1");
  });

  it("returns error after maxCalls exceeded", async () => {
    const handler = vi.fn(async () => "ok");
    const limited = createRateLimitedHandler(handler, {
      maxCalls: 2,
      windowMs: 10000,
    });
    await limited({});
    await limited({});
    const result = await limited({});
    expect(result).toEqual({ success: false, error: "Rate limit exceeded" });
  });

  it("clears old timestamps outside window", async () => {
    vi.useFakeTimers();
    const handler = vi.fn(async () => "ok");
    const limited = createRateLimitedHandler(handler, {
      maxCalls: 1,
      windowMs: 100,
    });
    await limited({});
    vi.advanceTimersByTime(150); // past window
    const result = await limited({});
    expect(result).toBe("ok"); // not rate limited
    vi.useRealTimers();
  });
});
```

## 4. Unit 测试设计 — Manager 纯逻辑（P1，~80 tests）

> 详细设计见后台 agent 产出的 `deep-test-design-managers.md`

### 4.1 clipboard.ts 纯逻辑方法（~12 tests）

**可测方法**：

- `pasteWindows()` — spawn 命令构建（mock spawn）
- `pasteLinux()` — xclip 命令构建
- `safeLog()` — 日志安全包装
- `hasTimedOut` — 超时守卫逻辑

### 4.2 hotkeyManager.ts 纯逻辑方法（~10 tests）

**可测方法**：

- 快捷键格式解析 "CommandOrControl+Shift+R"
- F2 双击去抖动时序
- 快捷键注册状态管理

### 4.3 modelManager.ts 纯逻辑方法（~15 tests）

**可测方法**：

- `findDamoRoot()` — 文件系统遍历（mock fs）
- `_verifyModel()` — 文件大小验证
- `getDownloadScriptPath()` — 路径构建
- `getModelCachePath()` — 缓存路径

### 4.4 pythonEnvironment.ts 纯逻辑方法（~14 tests）

**可测方法**：

- `isPythonVersionSupported()` — 版本比较（已有部分测试）
- `buildPythonEnvironment()` — env 变量构建
- `setupIsolatedEnvironment()` — PYTHONHOME/PYTHONPATH 设置

### 4.5 funasrServer.ts 纯逻辑方法（~10 tests）

**可测方法**：

- `calculateTranscriptionTimeout()` — 超时计算（已有测试）
- 消息路由逻辑
- 健康检查时序

### 4.6 tray.ts 菜单构建（~5 tests）

**可测方法**：

- `getTrayIconPath()` — 路径构建
- 菜单模板构建逻辑

### 4.7 logManager.ts 文件轮转（~5 tests）

**可测方法**：

- 日志文件大小检查和轮转
- 日志格式化

### 4.8 windowManager.ts alwaysOnTop 管理（~5 tests）

**可测方法**：

- `setDefaultAlwaysOnTop()` 状态管理
- 窗口创建参数构建

## 5. Integration 测试设计 — IPC 深度测试（P2，~50 tests）

### 5.1 IPC 返回值结构验证

> US-006 已验证通道注册完整性。这里验证每个 handler 的**返回值结构**。

```typescript
describe("IPC handler return value contracts", () => {
  // 每个 handler 调用后验证返回值结构

  describe("TRANSCRIPTION.SAVE returns { success, lastInsertRowid }", () => {
    it("returns success:true with numeric lastInsertRowid on valid input");
    it("returns success:false with error message on null input");
    it("returns success:false with error message on DB exception");
  });

  describe("TRANSCRIPTION.VALIDATE_FILE returns { success, error? }", () => {
    it("returns success:false for unsupported extension");
    it("returns success:false for non-existent file");
    it("returns success:false for file > 500MB");
    it("returns success:true with metadata for valid file");
  });

  // ... 每组 IPC handler
});
```

### 5.2 Rate limiter 集成

```typescript
describe("IPC rate limiter integration with real handlers", () => {
  it("AI.PROCESS limited to 20 calls per minute", async () => {
    // 注册真实 handler + rate limiter
    // 调用 20 次 → 全部成功
    // 第 21 次 → rate limit error
  });

  it("MODELS.DOWNLOAD limited to 3 calls per 5 minutes", async () => {
    // 调用 3 次 → 成功
    // 第 4 次 → rate limit
  });
});
```

### 5.3 Database + Settings 端到端

```typescript
describe("Database settings lifecycle", () => {
  it("set → get roundtrip preserves value", () => {
    db.setSetting("test_key", "test_value");
    expect(db.getSetting("test_key", "")).toBe("test_value");
  });

  it("encrypted key roundtrips through safeStorage", () => {
    db.setSafeStorage(mockSafeStorage);
    db.setSetting("ai_api_key", "sk-xxx");
    expect(db.getSetting("ai_api_key", "")).toBe("sk-xxx");
  });

  it("schema migration from v0 to current", () => {
    // 模拟旧版本 DB schema
    // 验证自动迁移
  });
});
```

## 6. E2E 测试设计 — CI 可靠的旅程（P2，~25 tests）

> 详细代码见后台 agent 产出的 `deep-test-design-e2e.md`

### 6.1 设计原则

1. **所有外部依赖用 IPC mock** — 不依赖真实 Python/FunASR/AI API
2. **CI 可靠** — 用 `app.disableHardwareAcceleration()` + IPC mock，不依赖 GUI 渲染
3. **每个 test suite 独立** — 自己的 app 实例 + in-memory DB
4. **Tier 分层** — Tier 1（CI 必须）、Tier 2（CI 可选）、Tier 3（本地优先）

### 6.2 Tier 1 — 启动冒烟（5 tests，CI 必须）

```
1. app 启动 → 主窗口可见
2. preload 暴露 electronAPI（50+ 方法）
3. app version 合法 semver
4. renderer HTML 无加载错误
5. CSP 头已设置
```

### 6.3 Tier 2 — IPC 功能（10 tests，CI 可选）

```
6. settings get/set roundtrip
7. transcription save/get/delete
8. clipboard copy/paste
9. window minimize/maximize
10. history search + export
11. AI provider presets available
12. model check returns valid structure
13. settings import/export
14. transcription AI review (mock AI)
15. error handling (invalid input rejected)
```

### 6.4 Tier 3 — 完整旅程（10 tests，本地优先）

```
16. 录音流程: mic click → transcription → AI optimize → clipboard
17. 文件导入: file mode → validate → transcribe → export
18. 模型下载: need_download → progress → ready
19. 托盘: tray click → show/hide → quit
20. 多窗口: main + history + settings 同时
21. 错误恢复: FunASR 不可用 → 降级
22. 错误恢复: AI 不可达 → 错误提示
23. 更新检查: check → download → verify SHA256
24. 设置持久化: change → reload → persisted
25. 快捷键: register → trigger → recording toggle
```

## 7. 错误路径测试设计（P3，~30 tests）

> 详细设计见后台 agent 产出的 `deep-test-design-error-paths.md`

### 7.1 安全关键路径

```
- 路径遍历攻击 (../../etc/passwd)
- SSRF (http://localhost 检查绕过)
- SHA256 校验失败
- API key 泄露（不应出现在日志中）
- 导入恶意 settings JSON
```

### 7.2 资源耗尽路径

```
- 磁盘满（下载/导出失败）
- 内存不足（模型加载）
- 连接超时（AI API / FunASR server）
- SQLite 锁定（并发写入）
```

### 7.3 数据完整性路径

```
- corrupt segments JSON
- DB schema 旧版本迁移
- 加密不可用 → 明文 fallback
- 损坏音频文件
```

## 8. 测试基础设施改进（P4）

### 8.1 共享 Mock 工厂

```typescript
// tests/helpers/mocks.ts
export function createMockIpcMain() {
  const handlers = new Map();
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
    _handlers: handlers,
    _get: (channel) => handlers.get(channel),
  };
}

export function createMockDb(overrides = {}) {
  return {
    saveTranscription: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
    getTranscriptionById: vi.fn(() => null),
    getTranscriptions: vi.fn(() => []),
    deleteTranscription: vi.fn(() => true),
    getSetting: vi.fn((_key, def) => def),
    setSetting: vi.fn(),
    getAllSettings: vi.fn(() => ({})),
    ...overrides,
  };
}

export function createMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

export function createMockSafeStorage() {
  return {
    encryptString: vi.fn((s) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b) => b.toString().replace("enc:", "")),
    isEncryptionAvailable: vi.fn(() => true),
  };
}
```

### 8.2 测试数据库工厂

```typescript
// tests/helpers/db.ts
export function createTestDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const DatabaseManager = require("../../src/helpers/database");
  const db = new DatabaseManager();
  db.initialize(path.dirname(dbPath));
  return {
    db,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}
```

### 8.3 音频 fixture 生成

```typescript
// tests/helpers/audio.ts
export function createTestAudioFile(durationSec = 1) {
  const tmpFile = path.join(os.tmpdir(), `test-${Date.now()}.wav`);
  // 生成最小有效 WAV 文件（44字节头 +  silence）
  const sampleRate = 16000;
  const numSamples = sampleRate * durationSec;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  // WAV header...
  fs.writeFileSync(tmpFile, buffer);
  return tmpFile;
}
```

## 9. 实施计划

| 优先级   | 任务                              | 测试数          | 预期覆盖率提升      |
| -------- | --------------------------------- | --------------- | ------------------- |
| **P0**   | fileConfig.ts 错误路径            | 8               | branch +6%          |
| **P0**   | database.ts 错误路径              | 12              | branch +8%          |
| **P0**   | providerPresets getProviderByName | 2               | func +33%           |
| **P0**   | ipcRateLimiter 执行路径           | 3               | func +50%           |
| **P1**   | clipboard 纯逻辑                  | 12              | (excluded→included) |
| **P1**   | hotkeyManager 纯逻辑              | 10              | (excluded→included) |
| **P1**   | modelManager 纯逻辑               | 15              | (excluded→included) |
| **P1**   | pythonEnvironment 纯逻辑          | 14              | (excluded→included) |
| **P2**   | IPC 返回值结构验证                | 30              | integration 层      |
| **P2**   | E2E Tier 1-2（CI 可靠）           | 15              | e2e 0→15            |
| **P3**   | E2E Tier 3（完整旅程）            | 10              | e2e 15→25           |
| **P3**   | 安全/资源错误路径                 | 20              | branch +5%          |
| **P4**   | 测试基础设施                      | 0               | 基建                |
| **总计** |                                   | **~151 新测试** | branch 75%→88%+     |

## 10. 参考资料

- [Electron Automated Testing 官方文档](https://electronjs.org/docs/latest/tutorial/automated-testing)
- [Testing Electron Apps — Emad Ibrahim](https://emadibrahim.com/electron-guide/testing)
- [Vitest GitHub Issue #4166 — vi.mock vs require](https://github.com/vitest-dev/vitest/issues/4166)
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking)
- [70/20/10 测试金字塔规则](https://www.ranorex.com/blog/end-to-end-testing-vs-integration-testing-explained/)
