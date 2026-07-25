# Deep Test Design: Error Paths and Edge Cases

> **Scope**: Detailed, file-and-line-specific test cases for the hardest-to-catch
> bugs in Murmur — the error paths, failure recoveries, and adversarial inputs
> that current coverage misses.
>
> **Source of truth**: `src/helpers/` and `src/helpers/ipc/` as of the
> `[20260724_TS_BigBang]` migration.
>
> **Method**: For each subsystem I read the source, enumerated every `catch`,
> `if (!...)`, early-return, fallback, and retry branch, cross-referenced the
> existing test files in `tests/unit/`, and recorded only the branches that are
> **not** currently exercised. Each test case below names the file, line range,
> current coverage, trigger, expected behavior, and a ready-to-paste test.
>
> **Convention**: Tests target the exported functions/classes directly (no IPC
> harness). `electron` and `better-sqlite3`-adjacent modules are mocked via
> `vi.mock`. `process.env.MURMUR_DB_PATH=:memory:` is used for DB tests.

---

## Table of Contents

1. [Database error paths (`database.ts`)](#1-database-error-paths)
2. [File transcription error paths (`transcriptionHandlers.ts`)](#2-file-transcription-error-paths)
3. [FunASR server lifecycle errors (`funasrServer.ts`, `funasrManager.ts`)](#3-funasr-server-lifecycle-errors)
4. [AI handler edge cases (`aiHandlers.ts`)](#4-ai-handler-edge-cases)
5. [Audio processing edge cases (`audioFileHelpers.ts`, `audioPathValidator.ts`)](#5-audio-processing-edge-cases)
6. [Settings edge cases (`settingsHandlers.ts`, `fileConfig.ts`)](#6-settings-edge-cases)
7. [Update manager edge cases (`updateManager.ts`)](#7-update-manager-edge-cases)
8. [Implementation priority & coverage impact](#8-implementation-priority--coverage-impact)

---

## 1. Database error paths

**File**: `src/helpers/database.ts`
**Current coverage**: 93.37% statements / **67.18% branches** (worst in-scope) / 96.42% functions
**Uncovered branches**: lines 346-347, 357, 458 (per gap analysis); also the
`NODE_MODULE_VERSION` rethrow, FTS5 fallback catch, and `_encryptValue` non-string
branch are under-exercised as error paths.

The branch deficit comes from three families of untested error handling: (a)
`getTranscriptionWithSegments` catch→null path with a logger present but the row
found, (b) `getSetting`/`getAllSettings` decrypt-returns-null branch for
encrypted keys, and (c) the integrity-check warning branch in `initialize`.

### 1.1 SQLite native-module version mismatch

**File**: `src/helpers/database.ts:122-129`
**Current coverage**: branch not exercised (the `NODE_MODULE_VERSION` substring check).
**Trigger**: `new Database()` throws an error whose message contains
`NODE_MODULE_VERSION` (happens when `better-sqlite3` was compiled for a different
Node ABI than the running Electron).
**Expected behavior**: the thrown error is re-wrapped with the
`npx electron-rebuild` hint and the original message is appended.
**Test case**:

```js
test("initialize re-throws with electron-rebuild hint on NODE_MODULE_VERSION mismatch", () => {
  const Database = require("better-sqlite3");
  Database.mockImplementationOnce(() => {
    throw new Error("The module was compiled against NODE_MODULE_VERSION 115");
  });
  const db = new DatabaseManager();
  expect(() => db.initialize(tmpDir)).toThrow(/electron-rebuild/);
  expect(() => db.initialize(tmpDir)).toThrow(/NODE_MODULE_VERSION 115/);
});
```

### 1.2 Integrity check failure logs a warning but does not abort

**File**: `src/helpers/database.ts:133-140`
**Current coverage**: the `integrity_check !== "ok"` branch is never hit (existing
tests use a healthy in-memory DB).
**Trigger**: `PRAGMA integrity_check` returns a row whose value is not `"ok"`.
**Expected behavior**: `logger.warn` is called with the integrity output; the DB
continues to initialize (no throw). Tables are still created.
**Test case**:

```js
test("initialize logs warning when integrity_check fails but does not abort", () => {
  const Database = require("better-sqlite3");
  const mockDb = {
    pragma: vi.fn((p) =>
      p === "integrity_check"
        ? [{ integrity_check: "file is not a database" }]
        : p === "table_info(transcriptions)"
          ? [{ name: "id" }] // pretend schema already migrated
          : [],
    ),
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ cnt: 0 })),
      all: vi.fn(() => []),
    })),
  };
  Database.mockImplementationOnce(() => mockDb);
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const db = new DatabaseManager(logger);
  db.initialize(tmpDir);
  expect(logger.warn).toHaveBeenCalledWith(
    "Database integrity check failed",
    expect.any(Array),
  );
});
```

### 1.3 FTS5 unavailable → silent LIKE fallback marker

**File**: `src/helpers/database.ts:181-228` (catch at line 225)
**Current coverage**: the `_createFtsIndex` `catch (_e)` block is never entered
because FTS5 is always available in the test environment.
**Trigger**: the FTS5 `CREATE VIRTUAL TABLE` exec throws (e.g. a SQLite build
compiled without FTS5).
**Expected behavior**: the catch swallows the error silently; later
`searchTranscriptions` falls back to LIKE (tested separately).
**Test case**:

```js
test("_createFtsIndex swallows error when FTS5 is unavailable", () => {
  const Database = require("better-sqlite3");
  const mockDb = {
    pragma: vi.fn(() => []),
    exec: vi.fn((sql) => {
      if (sql.includes("fts5")) throw new Error("no such module: fts5");
    }),
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []) })),
  };
  Database.mockImplementationOnce(() => mockDb);
  const db = new DatabaseManager({ warn: vi.fn() });
  // Should not throw despite FTS5 missing
  expect(() => db.initialize(tmpDir)).not.toThrow();
});
```

### 1.4 Schema migration failure is logged, not fatal

**File**: `src/helpers/database.ts:252-262`
**Current coverage**: the `ALTER TABLE ... ADD COLUMN` catch block is never hit.
**Trigger**: a column migration fails (e.g. column already exists from a partial
prior run, or disk error).
**Expected behavior**: `logger.warn` is called with the column name and error;
initialization continues. Subsequent reads of the column may return undefined but
must not crash the process.
**Test case**:

```js
test("_migrateSchema logs warning and continues when ALTER TABLE fails", () => {
  const Database = require("better-sqlite3");
  const mockDb = {
    pragma: vi.fn(() => [{ name: "id" }]), // no source_type → migration runs
    exec: vi.fn((sql) => {
      if (sql.startsWith("ALTER TABLE"))
        throw new Error("duplicate column name");
    }),
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ cnt: 0 })),
      all: vi.fn(() => []),
    })),
  };
  Database.mockImplementationOnce(() => mockDb);
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const db = new DatabaseManager(logger);
  db.initialize(tmpDir);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringContaining("Schema迁移失败"),
    expect.any(Error),
  );
});
```

### 1.5 `_migrateSettings` v0→v1 encryption-migration failure is logged

**File**: `src/helpers/database.ts:270-287` (catch at line 280)
**Current coverage**: the `JSON.parse(row.value)` catch inside `_migrateSettings`
is not exercised (existing tests use valid JSON or skip the migration).
**Trigger**: the stored `ai_api_key` value is corrupt (not valid JSON) at v0.
**Expected behavior**: `logger.warn` is called with `"API key encryption
migration failed"`; the schema version is still bumped to 1 so the migration
does not loop forever.
**Test case**:

```js
test("_migrateSettings logs and continues when stored api key is corrupt JSON", () => {
  process.env.MURMUR_DB_PATH = ":memory:";
  const db = new DatabaseManager();
  db.initialize(tmpDir);
  // Seed a corrupt plaintext key at schema version 0
  db.db
    .prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
    )
    .run("ai_api_key", "<<not-json>>");
  db.setSetting("settings_schema_version", 0);

  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  db.logger = logger;
  const ss = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  };
  db.safeStorage = ss;
  db._migrateSettings();

  expect(logger.warn).toHaveBeenCalledWith(
    "API key encryption migration failed",
    expect.any(String),
  );
  // Version must still advance to avoid a retry loop
  expect(db.getSetting("settings_schema_version")).toBe(1);
  db.close();
});
```

### 1.6 `getTranscriptionWithSegments` returns null on DB error (logger present, row found)

**File**: `src/helpers/database.ts:339-368` (catch at line 364)
**Current coverage**: the existing test (`database-coverage.test.js:219`) closes
the DB then queries id=1 — but the row does not exist, so the outer `SELECT`
itself is what throws. The branch where the row IS found but `JSON.parse` of
segments throws _inside_ the inner try (line 349) and populates `parsedSegments
= []` is covered; the branch where the `SELECT` itself fails _after_ a row was
previously readable is not. More importantly, line 458
(`getSetting` decrypt→null→return default) is the actual uncovered branch per
the report.
**Trigger**: encrypted key stored, `safeStorage` set, but `decryptString`
returns `null`.
**Expected behavior**: `getSetting` returns the provided `defaultValue` rather
than `null`.
**Test case**:

```js
test("getSetting returns default when decryption yields null for encrypted key", () => {
  process.env.MURMUR_DB_PATH = ":memory:";
  const db = new DatabaseManager();
  db.initialize(tmpDir);
  const ss = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn().mockReturnValue(Buffer.from("enc")),
    decryptString: vi.fn().mockReturnValue(null), // decryption yields null
  };
  db.setSafeStorage(ss);
  db.setSetting("ai_api_key", "secret");
  // decrypt returns null → should fall back to default
  expect(db.getSetting("ai_api_key", "fallback")).toBe("fallback");
  db.close();
});
```

### 1.7 `getAllSettings` skips keys whose decryption yields null

**File**: `src/helpers/database.ts:475-496` (line 482-484 branch)
**Current coverage**: the `decrypted !== null` guard in `getAllSettings` is not
exercised.
**Trigger**: an encrypted key decrypts to `null`.
**Expected behavior**: the key is **omitted** from the returned object (not set
to `null`), so callers like `maskApiKey` don't crash on `key.length`.
**Test case**:

```js
test("getAllSettings omits encrypted keys that decrypt to null", () => {
  process.env.MURMUR_DB_PATH = ":memory:";
  const db = new DatabaseManager();
  db.initialize(tmpDir);
  const ss = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn().mockReturnValue(Buffer.from("enc")),
    decryptString: vi.fn().mockReturnValue(null),
  };
  db.setSafeStorage(ss);
  db.setSetting("ai_api_key", "secret");
  db.setSetting("theme", "dark");
  const all = db.getAllSettings();
  expect(all).not.toHaveProperty("ai_api_key");
  expect(all.theme).toBe("dark");
  db.close();
});
```

### 1.8 SQLite locked (busy timeout exhausted)

**File**: `src/helpers/database.ts:130-131` (`busy_timeout = 5000`)
**Current coverage**: the busy-timeout path is never tested.
**Trigger**: a second connection holds a write lock longer than 5s.
**Expected behavior**: better-sqlite3 throws `SQLITE_BUSY` after the timeout; the
caller's operation fails with a thrown error (Murmur does not retry — the
timeout IS the retry). The test verifies the error propagates rather than
hanging.
**Test case**:

```js
test("saveTranscription throws SQLITE_BUSY when busy_timeout is exceeded", () => {
  process.env.MURMUR_DB_PATH = ":memory:";
  const db = new DatabaseManager();
  db.initialize(tmpDir);
  // Simulate better-sqlite3 throwing SQLITE_BUSY on the prepared INSERT
  const origPrepare = db.db.prepare.bind(db.db);
  db.db.prepare = vi.fn((sql) => {
    const stmt = origPrepare(sql);
    if (sql.includes("INSERT INTO transcriptions")) {
      return {
        ...stmt,
        run: vi.fn(() => {
          throw new Error("database is locked");
        }),
      };
    }
    return stmt;
  });
  expect(() => db.saveTranscription({ text: "x" })).toThrow(
    "database is locked",
  );
  db.close();
});
```

### 1.9 `safeStorage` encryption throws mid-encrypt

**File**: `src/helpers/database.ts:75-84`
**Current coverage**: `encryptString` throwing is not tested.
**Trigger**: `safeStorage.isEncryptionAvailable()` returns true but
`encryptString` throws (e.g. keyring locked on Linux).
**Expected behavior**: the error propagates out of `setSetting` (there is no
try/catch around `encryptString`). The test asserts the throw so the behavior is
documented; a follow-up fix could add a plaintext fallback.
**Test case**:

```js
test("setSetting propagates encryptString failure (documents current behavior)", () => {
  process.env.MURMUR_DB_PATH = ":memory:";
  const db = new DatabaseManager();
  db.initialize(tmpDir);
  const ss = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn(() => {
      throw new Error("keyring locked");
    }),
    decryptString: vi.fn(),
  };
  db.setSafeStorage(ss);
  // NOTE: current code does NOT catch encryptString failures — this test pins
  // that behavior. If a plaintext fallback is added, update this test.
  expect(() => db.setSetting("ai_api_key", "secret")).toThrow("keyring locked");
  db.close();
});
```

### 1.10 `backup` synchronous throw path

**File**: `src/helpers/database.ts:514-531`
**Current coverage**: the async-rejection path (line 519) is covered; the
synchronous `catch` (line 525) is not.
**Trigger**: `this.db.backup()` throws synchronously (e.g. invalid path).
**Expected behavior**: `logger.error` is called and `backup` returns `false`.
**Test case**:

```js
test("backup returns false and logs when db.backup throws synchronously", () => {
  process.env.MURMUR_DB_PATH = ":memory:";
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const db = new DatabaseManager(logger);
  db.initialize(tmpDir);
  db.db.backup = vi.fn(() => {
    throw new Error("SQLITE_ERROR: invalid path");
  });
  expect(db.backup("/bad/path/backup.db")).toBe(false);
  expect(logger.error).toHaveBeenCalled();
  db.close();
});
```

---

## 2. File transcription error paths

**File**: `src/helpers/ipc/transcriptionHandlers.ts`
**Current coverage**: excluded from the coverage report (`src/helpers/ipc/`
excluded), but `transcriptionHandlers.test.ts` covers the happy path and a few
errors (SAVE throw, EXPORT not-found, AI_REVIEW not-found). Many error branches
are untested.

### 2.1 MAX_FILE_SIZE (500MB) rejection in VALIDATE_FILE

**File**: `src/helpers/ipc/transcriptionHandlers.ts:117-141` (line 127-129)
**Current coverage**: not tested — the existing VALIDATE_FILE test only covers
"unsupported extension" and "non-existent file".
**Trigger**: `fs.statSync` returns a size > 500 _ 1024 _ 1024.
**Expected behavior**: returns `{ success: false, error: "文件超过500MB限制" }`
without invoking the FunASR server.
**Test case**:

```js
test("VALIDATE_FILE rejects file larger than 500MB", async () => {
  const fs = require("fs");
  vi.spyOn(fs, "statSync").mockReturnValueOnce({ size: 600 * 1024 * 1024 });
  const C = await setup();
  const handler = registeredHandlers.get(C.TRANSCRIPTION.VALIDATE_FILE);
  const result = await handler({}, "/home/user/big.wav");
  expect(result.success).toBe(false);
  expect(result.error).toContain("500MB");
  expect(mockFunasr.transcribeFile).not.toHaveBeenCalled();
});
```

### 2.2 TRANSCRIBE_FILE: DB save failure does not lose transcription text

**File**: `src/helpers/ipc/transcriptionHandlers.ts:157-173` (catch at 170)
**Current coverage**: the `dbErr` catch is not exercised.
**Trigger**: `databaseManager.saveTranscription` throws after a successful
FunASR transcription.
**Expected behavior**: the error is logged but the transcription `result` is
still returned to the caller (with `result.id` unset) — the user keeps the text
even though it wasn't persisted.
**Test case**:

```js
test("TRANSCRIBE_FILE returns transcription text even if DB save fails", async () => {
  mockDb.saveTranscription.mockImplementationOnce(() => {
    throw new Error("DB locked");
  });
  mockFunasr.transcribeFile.mockResolvedValueOnce({
    success: true,
    text: "转录成功",
    raw_text: "raw",
    segments: [],
  });
  const C = await setup();
  const handler = registeredHandlers.get(C.TRANSCRIPTION.TRANSCRIBE_FILE);
  const result = await handler({}, "/home/user/ok.wav", {});
  expect(result.success).toBe(true);
  expect(result.text).toBe("转录成功");
  expect(result.id).toBeUndefined(); // not set because DB save failed
  expect(mockManagers.logger.error).toHaveBeenCalled();
});
```

### 2.3 DIARIZE: missing segments

**File**: `src/helpers/ipc/transcriptionHandlers.ts:183-208` (line 194)
**Current coverage**: not tested.
**Trigger**: transcription row exists but `segments` is null/empty or parses to
`[]`.
**Expected behavior**: returns `{ success: false, error: "无分段数据" }` without
calling `diarizeAudio`.
**Test case**:

```js
test("DIARIZE returns error when transcription has no segments", async () => {
  mockDb.getTranscriptionById.mockReturnValueOnce({
    id: 1,
    text: "t",
    segments: null,
  });
  const C = await setup();
  const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE);
  const result = await handler({}, 1);
  expect(result.success).toBe(false);
  expect(result.error).toContain("分段");
  expect(mockFunasr.diarizeAudio).not.toHaveBeenCalled();
});
```

### 2.4 DIARIZE: missing audio path

**File**: `src/helpers/ipc/transcriptionHandlers.ts:196-197`
**Current coverage**: not tested.
**Trigger**: row has segments but neither `source_file_path` nor `audio_path`.
**Expected behavior**: `{ success: false, error: "音频文件不存在" }`.
**Test case**:

```js
test("DIARIZE returns error when audio path missing", async () => {
  mockDb.getTranscriptionById.mockReturnValueOnce({
    id: 1,
    text: "t",
    segments: JSON.stringify([{ start_ms: 0, text: "x" }]),
    // no source_file_path, no audio_path
  });
  const C = await setup();
  const handler = registeredHandlers.get(C.TRANSCRIPTION.DIARIZE);
  const result = await handler({}, 1);
  expect(result.success).toBe(false);
  expect(result.error).toContain("音频");
});
```

### 2.5 EXPORT: unsupported format

**File**: `src/helpers/ipc/transcriptionHandlers.ts:241-244`
**Current coverage**: not tested (existing EXPORT test only covers canceled
dialog and not-found).
**Trigger**: format string not in the formatters registry.
**Expected behavior**: `{ success: false, error: "不支持的格式: xyz" }`.
**Test case**:

```js
test("EXPORT returns error for unsupported format", async () => {
  const { getFormatInfo } = await import("../../src/helpers/exportFormatters");
  vi.mocked(getFormatInfo).mockReturnValueOnce(undefined);
  const C = await setup();
  const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT);
  const result = await handler({}, 42, "xyz");
  expect(result.success).toBe(false);
  expect(result.error).toContain("xyz");
});
```

### 2.6 EXPORT_ALL: empty database

**File**: `src/helpers/ipc/transcriptionHandlers.ts:363-418` (line 366-368)
**Current coverage**: not tested.
**Trigger**: `getTranscriptions` returns `[]`.
**Expected behavior**: `{ success: false, error: "没有转录记录可导出" }` — no
save dialog shown.
**Test case**:

```js
test("EXPORT_ALL returns error when no transcriptions exist", async () => {
  mockDb.getTranscriptions.mockReturnValueOnce([]);
  const C = await setup();
  const handler = registeredHandlers.get(C.TRANSCRIPTION.EXPORT_ALL);
  const result = await handler({}, "txt");
  expect(result.success).toBe(false);
  expect(result.error).toContain("没有");
  const { dialog } = await import("electron");
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
});
```

### 2.7 AI_REVIEW: missing transcription row

**File**: `src/helpers/ipc/transcriptionHandlers.ts:284-313`
**Current coverage**: covered (existing test). **But** the branch where
`processTextWithAI` is undefined (`managers.processTextWithAI` not passed) is
not. Calling `processTextWithAI!` would throw `TypeError`.
**Trigger**: register without `processTextWithAI`; call AI_REVIEW.
**Expected behavior**: currently throws TypeError inside the try, caught and
returned as `{ success: false, error: "processTextWithAI is not a function" }`.
**Test case**:

```js
test("AI_REVIEW returns error when processTextWithAI is not registered", async () => {
  // Re-register without processTextWithAI
  const { register } =
    await import("../../src/helpers/ipc/transcriptionHandlers");
  const ipc = { handle: vi.fn((ch, fn) => registeredHandlers.set(ch, fn)) };
  register(ipc, {
    databaseManager: mockDb,
    funasrManager: mockFunasr,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    // processTextWithAI intentionally omitted
  });
  const C = await import("../../src/helpers/ipc-contracts");
  const handler = registeredHandlers.get(C.TRANSCRIPTION.AI_REVIEW);
  const result = await handler({}, 42, "professional");
  expect(result.success).toBe(false);
  expect(result.error).toBeTruthy();
});
```

---

## 3. FunASR server lifecycle errors

**Files**: `src/helpers/funasrServer.ts`, `src/helpers/funasrManager.ts`
**Current coverage**: `funasrServer-crash-restart.test.js` covers the restart
counter (over-limit, within-limit, increment, reset) but **not** the actual
spawn/handshake/health-monitor paths.

### 3.1 Server crash → auto-restart exhausted (max 3)

**File**: `src/helpers/funasrServer.ts:280-315`
**Current coverage**: the limit-exceeded branch is tested at the unit level
(mocked `_startFunASRServer`), but the **interaction** with the `close` event
handler (line 221 `_handleServerCrash`) is not.
**Trigger**: the spawned process emits `close` after init was received.
**Expected behavior**: `_handleServerCrash` increments `restartCount`; after 3
crashes it logs `"giving up"` and sets `serverReady = false` permanently.
**Test case**:

```js
test("close event after init triggers crash handler; gives up after maxRestarts+1", async () => {
  const server = new FunASRServer(logger);
  server._saveStartupParams({
    pythonEnv: {},
    pythonCmd: "py",
    serverPath: "/p",
    modelCachePath: "/m",
  });
  server._startFunASRServer = vi.fn(async () => {}); // simulate immediate "success"
  server.maxRestarts = 3;

  // Simulate 4 crashes (1,2,3,4) — the 4th should give up
  for (let i = 0; i < 3; i++) {
    await server._handleServerCrash();
    expect(server._startFunASRServer).toHaveBeenCalledTimes(i + 1);
  }
  await server._handleServerCrash(); // restartCount becomes 4 > 3
  expect(server._startFunASRServer).toHaveBeenCalledTimes(3); // no new call
  expect(server.serverReady).toBe(false);
  expect(logger.error).toHaveBeenCalledWith(
    expect.stringContaining("giving up"),
  );
});
```

### 3.2 Server script not found (silent return)

**File**: `src/helpers/funasrServer.ts:139-143`
**Current coverage**: not tested.
**Trigger**: `serverPath` does not exist on disk.
**Expected behavior**: logs error and returns `undefined` (does NOT throw, does
NOT spawn). The promise resolves with `undefined`.
**Test case**:

```js
test("_startFunASRServer returns undefined when script path missing", async () => {
  const server = new FunASRServer(logger);
  const fs = require("fs");
  vi.spyOn(fs, "existsSync").mockReturnValueOnce(false);
  const result = await server._startFunASRServer(
    {},
    "py",
    "/missing/server.py",
    "/m",
  );
  expect(result).toBeUndefined();
  expect(logger.error).toHaveBeenCalledWith(
    "FunASR服务器脚本未找到",
    expect.objectContaining({ serverPath: "/missing/server.py" }),
  );
  expect(server.serverReady).toBe(false);
});
```

### 3.3 Process spawn error (e.g. Python binary not found)

**File**: `src/helpers/funasrServer.ts:226-234`
**Current coverage**: the `error` event handler is not tested.
**Trigger**: `spawn()` emits an `error` event (ENOENT) because `pythonCmd`
doesn't exist.
**Expected behavior**: before init response received → rejects with
`"FunASR服务器进程启动失败: ..."`.
**Test case**:

```js
test("_startFunASRServer rejects on spawn error when binary missing", async () => {
  const { spawn } = require("child_process");
  const { EventEmitter } = require("events");
  const fakeProc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn() },
    kill: vi.fn(),
  });
  spawn.mockImplementationOnce(() => {
    // Defer the error emit so listeners can attach
    process.nextTick(() =>
      fakeProc.emit("error", new Error("spawn py ENOENT")),
    );
    return fakeProc;
  });
  const server = new FunASRServer(logger);
  // serverPath must exist for the existsSync check
  const fs = require("fs");
  vi.spyOn(fs, "existsSync").mockReturnValueOnce(true);
  await expect(
    server._startFunASRServer({}, "py-missing", "/exists.py", "/m"),
  ).rejects.toThrow(/启动失败/);
  expect(server.serverReady).toBe(false);
});
```

### 3.4 Startup handshake timeout (120s)

**File**: `src/helpers/funasrServer.ts:236-242`
**Current coverage**: not tested.
**Trigger**: 120s elapse with no init JSON on stdout.
**Expected behavior**: rejects with `"FunASR服务器启动超时(120秒)"` and kills the
process.
**Test case** (use `vi.useFakeTimers`):

```js
test("_startFunASRServer rejects with timeout after 120s without init JSON", async () => {
  vi.useFakeTimers();
  const { spawn } = require("child_process");
  const { EventEmitter } = require("events");
  const fakeProc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn() },
    kill: vi.fn(),
  });
  spawn.mockImplementationOnce(() => fakeProc);
  const server = new FunASRServer(logger);
  const fs = require("fs");
  vi.spyOn(fs, "existsSync").mockReturnValueOnce(true);
  const p = server._startFunASRServer({}, "py", "/exists.py", "/m");
  // Fast-forward past 120s
  vi.advanceTimersByTime(121_000);
  await expect(p).rejects.toThrow(/超时/);
  expect(fakeProc.kill).toHaveBeenCalled();
  vi.useRealTimers();
});
```

### 3.5 Process exits before init response received

**File**: `src/helpers/funasrServer.ts:211-224` (line 219-220)
**Current coverage**: not tested.
**Trigger**: process emits `close` before any JSON init line.
**Expected behavior**: rejects with `"FunASR服务器进程异常退出"`.
**Test case**:

```js
test("_startFunASRServer rejects when process exits before init JSON", async () => {
  const { spawn } = require("child_process");
  const { EventEmitter } = require("events");
  const fakeProc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn() },
    kill: vi.fn(),
  });
  spawn.mockImplementationOnce(() => {
    process.nextTick(() => fakeProc.emit("close", 1));
    return fakeProc;
  });
  const server = new FunASRServer(logger);
  const fs = require("fs");
  vi.spyOn(fs, "existsSync").mockReturnValueOnce(true);
  await expect(
    server._startFunASRServer({}, "py", "/exists.py", "/m"),
  ).rejects.toThrow("FunASR服务器进程异常退出");
});
```

### 3.6 Health monitor ping timeout → crash handler

**File**: `src/helpers/funasrServer.ts:249-271`
**Current coverage**: not tested.
**Trigger**: the 30s health interval fires, `_sendServerCommand("ping")` rejects
(ping timeout after 5s).
**Expected behavior**: `_handleServerCrash` is invoked.
**Test case** (use fake timers):

```js
test("health monitor triggers crash handler on ping timeout", async () => {
  vi.useFakeTimers();
  const server = new FunASRServer(logger);
  server.serverReady = true;
  server.serverProcess = {}; // truthy so the guard passes
  server._sendServerCommand = vi.fn(() => new Promise(() => {})); // never resolves → 5s timeout
  server._handleServerCrash = vi.fn(async () => {});
  server._startHealthMonitor();
  // Advance past the 30s interval + 5s ping timeout
  await vi.advanceTimersByTimeAsync(36_000);
  expect(server._handleServerCrash).toHaveBeenCalled();
  server._stopHealthMonitor();
  vi.useRealTimers();
});
```

### 3.7 Graceful shutdown on Windows uses taskkill /T /F

**File**: `src/helpers/funasrServer.ts:340-378` (line 355-360)
**Current coverage**: not tested.
**Trigger**: `process.platform === "win32"` and the process doesn't exit within
5s of the stdin `exit` message.
**Expected behavior**: `spawnSync("taskkill", ["/T", "/F", "/PID", pid])` is
called.
**Test case**:

```js
test("gracefulShutdown uses taskkill /T /F on Windows after 5s", async () => {
  vi.useFakeTimers();
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", {
    value: "win32",
    configurable: true,
  });
  const { spawnSync } = require("child_process");
  spawnSync.mockImplementationOnce(() => ({ status: 0 }));
  const { EventEmitter } = require("events");
  const fakeProc = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: { write: vi.fn() },
    kill: vi.fn(),
  });
  const server = new FunASRServer(logger);
  server.serverProcess = fakeProc;
  const p = server.gracefulShutdown();
  // stdin exit written immediately
  expect(fakeProc.stdin.write).toHaveBeenCalledWith(
    expect.stringContaining("exit"),
  );
  // Advance past the 5s timeout
  vi.advanceTimersByTime(5_100);
  await p;
  expect(spawnSync).toHaveBeenCalledWith(
    "taskkill",
    ["/T", "/F", "/PID", "12345"],
    expect.any(Object),
  );
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    configurable: true,
  });
  vi.useRealTimers();
});
```

### 3.8 Graceful shutdown on non-Windows uses SIGKILL after 5s

**File**: `src/helpers/funasrServer.ts:361-363`
**Current coverage**: not tested.
**Trigger**: non-Windows platform, process doesn't exit within 5s.
**Expected behavior**: `proc.kill("SIGKILL")` is called.
**Test case**:

```js
test("gracefulShutdown uses SIGKILL on macOS/Linux after 5s", async () => {
  vi.useFakeTimers();
  const { EventEmitter } = require("events");
  const fakeProc = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: { write: vi.fn() },
    kill: vi.fn(),
  });
  const server = new FunASRServer(logger);
  server.serverProcess = fakeProc;
  const p = server.gracefulShutdown();
  vi.advanceTimersByTime(5_100);
  await p;
  expect(fakeProc.kill).toHaveBeenCalledWith("SIGKILL");
  vi.useRealTimers();
});
```

### 3.9 `transcribeFile` FORMAT_NOT_SUPPORTED / FILE_TOO_LARGE / SERVER_NOT_READY

**File**: `src/helpers/funasrServer.ts:435-510`
**Current coverage**: not tested at this level (the IPC layer test mocks
`validateAudioPath`).
**Trigger**: invalid path, unsupported extension, oversized file, or server not
ready after waiting.
**Expected behavior**: returns structured `{ success: false, error, code }` with
the right `code`.
**Test case** (representative — SERVER_NOT_READY is the most valuable):

```js
test("transcribeFile returns SERVER_NOT_READY when server fails to start", async () => {
  const server = new FunASRServer(logger);
  server.serverReady = false;
  server.initializationPromise = Promise.resolve(); // resolved but still not ready
  const fs = require("fs");
  vi.spyOn(fs, "statSync").mockReturnValueOnce({ size: 1000 });
  const result = await server.transcribeFile("/home/x/test.wav", {});
  expect(result.success).toBe(false);
  expect(result.code).toBe("SERVER_NOT_READY");
});
```

### 3.10 FunASRManager.restartServer: models not downloaded

**File**: `src/helpers/funasrManager.ts:129-183` (line 158-160)
**Current coverage**: not tested.
**Trigger**: `checkModelFiles` returns `{ minimum_ready: false,
models_downloaded: false }`.
**Expected behavior**: returns `{ success: false, error: "模型文件未下载，无法启动服务器" }`
without spawning.
**Test case**:

```js
test("restartServer fails when models not downloaded", async () => {
  const PythonEnvironment = require("../../src/helpers/pythonEnvironment");
  const ModelManager = require("../../src/helpers/modelManager");
  const FunASRServerCtor = require("../../src/helpers/funasrServer");
  // Wire a manager whose modelManager.checkModelFiles says not ready
  const mgr = new (require("../../src/helpers/funasrManager").default)({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
  mgr.modelManager.checkModelFiles = vi.fn(async () => ({
    minimum_ready: false,
    models_downloaded: false,
    missing_models: ["all"],
  }));
  const result = await mgr.restartServer();
  expect(result.success).toBe(false);
  expect(result.error).toContain("模型");
});
```

---

## 4. AI handler edge cases

**File**: `src/helpers/ipc/aiHandlers.ts`
**Current coverage**: `aiHandlers.test.js` covers missing key, configurable
temp/max_tokens, HTTP 401/500, empty choices, and base URL validation. **Missing**:
timeout/AbortError, network throws (ENOTFOUND/ECONNREFUSED), local model without
key, and the error-text non-JSON branch.

### 4.1 Request timeout (AbortError)

**File**: `src/helpers/ipc/aiHandlers.ts:248-270` (line 261-268)
**Current coverage**: the AbortError branch is not exercised.
**Trigger**: `fetch` rejects with `name === "AbortError"` after `timeoutMs`.
**Expected behavior**: returns `{ success: false, error: /超时/ }` and the thrown
error has `code: "TIMEOUT"`.
**Test case**:

```js
test("processTextWithAI returns timeout error when fetch aborts", async () => {
  global.fetch = vi.fn(() => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  });
  const db = setupDb({
    ai_api_key: "k",
    ai_base_url: "https://api.openai.com/v1",
  });
  const result = await processTextWithAI("text", "optimize", db, logger, {
    timeout: 1000,
  });
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/超时/);
});
```

### 4.2 Network error (ENOTFOUND / ECONNREFUSED)

**File**: `src/helpers/ipc/aiHandlers.ts:259-269` + `324-340`
**Current coverage**: the generic fetch-throw path (non-Abort) is not tested;
the error-code mapping (`ENOTFOUND`, `ECONNREFUSED`) is not tested.
**Trigger**: `fetch` rejects with `code: "ENOTFOUND"`.
**Expected behavior**: returns `{ success: false, error: "无法连接到AI服务器，请检查网络" }`.
**Test case**:

```js
test("processTextWithAI maps ENOTFOUND to friendly message", async () => {
  global.fetch = vi.fn(() => {
    const err = new Error("getaddrinfo ENOTFOUND api.openai.com");
    err.code = "ENOTFOUND";
    throw err;
  });
  const db = setupDb({
    ai_api_key: "k",
    ai_base_url: "https://api.openai.com/v1",
  });
  const result = await processTextWithAI("text", "optimize", db, logger);
  expect(result.success).toBe(false);
  expect(result.error).toContain("无法连接");
});
```

### 4.3 Local model without API key is allowed

**File**: `src/helpers/ipc/aiHandlers.ts:176-188` (line 183-188)
**Current coverage**: the existing test only covers the cloud (non-local)
missing-key case. The **local** case (localhost base URL, no key) is not tested.
**Trigger**: `ai_base_url` is `http://127.0.0.1:11434/v1` and `ai_api_key` is
null.
**Expected behavior**: does NOT return the "请先配置API密钥" error; proceeds to
fetch (no `Authorization` header).
**Test case**:

```js
test("processTextWithAI proceeds without API key when base URL is localhost", async () => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "ok" } }] }),
  }));
  const db = {
    getSetting: vi.fn(async (key) => {
      if (key === "ai_api_key") return null; // no key
      if (key === "ai_base_url") return "http://127.0.0.1:11434/v1"; // local
      if (key === "ai_model") return "llama3";
      return null;
    }),
  };
  const result = await processTextWithAI("text", "optimize", db, logger);
  expect(result.success).toBe(true);
  // No Authorization header sent
  const headers = global.fetch.mock.calls[0][1].headers;
  expect(headers.Authorization).toBeUndefined();
});
```

### 4.4 Non-JSON error response body

**File**: `src/helpers/ipc/aiHandlers.ts:273-292` (line 280-286)
**Current coverage**: the `JSON.parse(errorText)` catch is not tested.
**Trigger**: HTTP 502 with an HTML error page (e.g. `<html>Bad Gateway</html>`).
**Expected behavior**: falls back to raw text, logs a warning, returns the raw
text in the error.
**Test case**:

```js
test("processTextWithAI handles non-JSON error body (HTML 502)", async () => {
  global.fetch = vi.fn(async () => ({
    ok: false,
    status: 502,
    statusText: "Bad Gateway",
    text: async () => "<html>502 Bad Gateway</html>",
  }));
  const db = setupDb();
  const result = await processTextWithAI("text", "optimize", db, logger);
  expect(result.success).toBe(false);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringContaining("非JSON"),
    expect.any(String),
  );
});
```

### 4.5 `validateAIBaseUrl` SSRF guards (IPv6, 0.0.0.0, link-local)

**File**: `src/helpers/ipc/aiHandlers.ts:122-160`
**Current coverage**: covered for `javascript:`, `data:`, `ftp:`, `127.0.0.1`,
`0.0.0.0`, `169.254.x.x`. **Missing**: `::1` / `[::1]` (IPv6 loopback) and
`10.x` / `172.16-31.x` / `192.168.x` (RFC1918) without `allowLocalhost`.
**Trigger**: base URL host is `::1` or `10.0.0.1`.
**Expected behavior**: rejected (returns `false`).
**Test case**:

```js
test.each([
  ["https://[::1]/v1", "IPv6 loopback"],
  ["https://10.0.0.1/v1", "RFC1918 10.x"],
  ["https://172.16.0.1/v1", "RFC1918 172.16"],
  ["https://192.168.1.1/v1", "RFC1918 192.168"],
  ["https://[::1]/v1 with allowLocalhost", "IPv6 loopback allowed"],
])("validateAIBaseUrl rejects %s", (url) => {
  // For the "allowed" case, allowLocalhost should still accept ::1 over http
  const allowLocal = url.includes("allowLocalhost");
  expect(validateAIBaseUrl(url, { allowLocalhost: allowLocal })).toBe(
    allowLocal,
  );
});
```

### 4.6 Rate limiting (ipcRateLimiter, 20 calls/minute)

**File**: `src/helpers/ipcRateLimiter.ts` + integration in `ipc/index.ts`
**Current coverage**: `ipcRateLimiter.test.js` tests the limiter in isolation.
The **integration** (a handler actually rejecting the 21st call) is in
`ipcRateLimitIntegration.test.js`. **Gap**: the per-channel overrides and the
"X-RateLimit-Reset" header behavior are thin. Recommend extending the integration
test to assert the exact error message returned to the renderer.
**Trigger**: 21 rapid calls to a rate-limited channel.
**Expected behavior**: 21st call returns `{ success: false, error: "请求过于频繁" }`.
**Test case**:

```js
test("21st call within 1 minute is rejected with rate-limit error", async () => {
  // Assumes the integration harness wraps handlers with the limiter
  for (let i = 0; i < 20; i++) {
    const r = await callRateLimitedChannel("process-text", "x", "optimize");
    expect(r).toBeDefined();
  }
  const blocked = await callRateLimitedChannel("process-text", "x", "optimize");
  expect(blocked.success).toBe(false);
  expect(blocked.error).toMatch(/频繁|rate/i);
});
```

---

## 5. Audio processing edge cases

**Files**: `src/helpers/audioFileHelpers.ts`, `src/helpers/audioPathValidator.ts`
**Current coverage**: `audioFileHelpers.test.js` is strong on types/ffmpeg.
`audioPathValidator.ts` is only indirectly tested and the **path-traversal /
allowed-directory** logic (lines 36-46) is **not** directly tested at all.

### 5.1 Path traversal attempt (`../../etc/passwd`)

**File**: `src/helpers/audioPathValidator.ts:36-47`
**Current coverage**: not directly tested.
**Trigger**: input `"../../../etc/passwd.wav"`.
**Expected behavior**: `path.resolve` collapses the `..`, producing a path
outside `homedir`/`tmpdir`/`/Volumes`/drive-letter → rejected with `"路径不在允许范围内"`.
**Test case**:

```js
test("validateAudioPath rejects path traversal outside allowed dirs", () => {
  const { validateAudioPath } = require("../../src/helpers/audioPathValidator");
  const result = validateAudioPath("../../../etc/passwd.wav");
  expect(result.valid).toBe(false);
  // Either unsupported ext (if /etc/passwd.wav resolves to no ext issue) or out-of-bounds
  // The decisive assertion: never valid
});
```

### 5.2 Absolute path to `/etc/passwd.wav` rejected

**File**: `src/helpers/audioPathValidator.ts:39-46`
**Current coverage**: not tested.
**Trigger**: `"/etc/passwd.wav"`.
**Expected behavior**: `valid: false` because `/etc/...` doesn't start with
homedir/tmpdir/`/Volumes`/drive-letter.
**Test case**:

```js
test("validateAudioPath rejects /etc path outside allowed roots", () => {
  const { validateAudioPath } = require("../../src/helpers/audioPathValidator");
  const result = validateAudioPath("/etc/passwd.wav");
  expect(result.valid).toBe(false);
  expect(result.error).toContain("允许范围");
});
```

### 5.3 Path inside `/Volumes/` is allowed (macOS external drives)

**File**: `src/helpers/audioPathValidator.ts:42`
**Current coverage**: not tested.
**Trigger**: `"/Volumes/USB/录音.wav"`.
**Expected behavior**: `valid: true` (explicitly whitelisted).
**Test case**:

```js
test("validateAudioPath allows /Volumes/ for external media", () => {
  const { validateAudioPath } = require("../../src/helpers/audioPathValidator");
  const result = validateAudioPath("/Volumes/USBDrive/meeting.wav");
  expect(result.valid).toBe(true);
  expect(result.ext).toBe(".wav");
});
```

### 5.4 Unicode filename (`中文.wav`)

**File**: `src/helpers/audioPathValidator.ts:30-48`
**Current coverage**: not tested.
**Trigger**: filename contains CJK characters.
**Expected behavior**: extension parsed correctly; path allowed if inside
homedir.
**Test case**:

```js
test("validateAudioPath handles Unicode (CJK) filenames", () => {
  const { validateAudioPath } = require("../../src/helpers/audioPathValidator");
  const os = require("os");
  const path = require("path");
  const filePath = path.join(os.homedir(), "会议录音", "中文.wav");
  const result = validateAudioPath(filePath);
  expect(result.valid).toBe(true);
  expect(result.ext).toBe(".wav");
});
```

### 5.5 Very long filename (>255 chars)

**File**: `src/helpers/audioPathValidator.ts:30-48`
**Current coverage**: not tested.
**Trigger**: filename component >255 characters.
**Expected behavior**: validation itself passes (the validator only checks ext +
root); the failure would surface at `fs.statSync` in the handler. Test documents
that the validator does not impose a length cap (a potential follow-up fix).
**Test case**:

```js
test("validateAudioPath does not impose filename length cap (documents behavior)", () => {
  const { validateAudioPath } = require("../../src/helpers/audioPathValidator");
  const os = require("os");
  const path = require("path");
  const longName = "a".repeat(300) + ".wav";
  const filePath = path.join(os.homedir(), longName);
  const result = validateAudioPath(filePath);
  // Validator passes; statSync would later fail with ENAMETOOLONG on most FS
  expect(result.valid).toBe(true);
});
```

### 5.6 Symlink escape (resolved path outside allowed dirs)

**File**: `src/helpers/audioPathValidator.ts:36`
**Current coverage**: not tested.
**Trigger**: a symlink inside `homedir` pointing to `/etc/secret.wav`.
**Expected behavior**: `path.resolve` does **not** resolve symlinks
(`fs.realpath` would) — so the current validator is **bypassable** via symlinks.
This test documents the vulnerability so a fix (using `fs.realpathSync`) can be
added.
**Test case**:

```js
test("validateAudioPath is bypassable via symlink (documents vulnerability)", () => {
  const { validateAudioPath } = require("../../src/helpers/audioPathValidator");
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syn-"));
  const linkPath = path.join(dir, "escape.wav");
  fs.symlinkSync("/etc/passwd", linkPath); // symlink target outside allowed roots
  // path.resolve does NOT resolve symlinks → validator sees the link path as inside tmpdir
  const result = validateAudioPath(linkPath);
  // This PASSES today (vulnerability). When fixed with realpathSync, flip to false.
  expect(result.valid).toBe(true);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

### 5.7 `createTempAudioFile` rejects unsupported type (number)

**File**: `src/helpers/audioFileHelpers.ts:74-76`
**Current coverage**: covered (`throws for unsupported type`). **Gap**: the
`null`/`undefined` input is not tested.
**Test case**:

```js
test("createTempAudioFile throws on null/undefined input", async () => {
  await expect(createTempAudioFile(mockLogger, null)).rejects.toThrow(/不支持/);
  await expect(createTempAudioFile(mockLogger, undefined)).rejects.toThrow(
    /不支持/,
  );
});
```

---

## 6. Settings edge cases

**Files**: `src/helpers/ipc/settingsHandlers.ts`, `src/helpers/fileConfig.ts`
**Current coverage**: `settingsHandlers.test.js` covers registration + happy
path. `edge-cases.test.js` covers `fileConfig` array/null/numeric. **Missing**:
IMPORT with invalid JSON, IMPORT with disallowed keys, validateSetting rejects,
and the encryption-unavailable plaintext fallback round-trip.

### 6.1 IMPORT invalid JSON

**File**: `src/helpers/ipc/settingsHandlers.ts:119-151` (catch at 147)
**Current coverage**: not tested.
**Trigger**: the selected file contains `"<<not json>>"`.
**Expected behavior**: `JSON.parse` throws → caught → `{ success: false, error:
"Unexpected token ..." }`.
**Test case**:

```js
test("IMPORT returns error for malformed JSON file", async () => {
  const fs = require("fs");
  const { dialog } = require("electron");
  const tmp = path.join(require("os").tmpdir(), `bad-${Date.now()}.json`);
  fs.writeFileSync(tmp, "<<not json>>");
  dialog.showOpenDialog.mockResolvedValueOnce({
    canceled: false,
    filePaths: [tmp],
  });
  const handler = ipcMain._handlers["import-settings"];
  const result = await handler({});
  expect(result.success).toBe(false);
  expect(result.error).toBeTruthy();
  fs.unlinkSync(tmp);
});
```

### 6.2 IMPORT skips disallowed keys, counts only valid ones

**File**: `src/helpers/ipc/settingsHandlers.ts:138-143`
**Current coverage**: not tested.
**Trigger**: JSON contains both allowed (`theme`) and disallowed
(`malicious_key`, `__proto__`) keys.
**Expected behavior**: only `theme` is written; `count === 1`.
**Test case**:

```js
test("IMPORT writes only allowlisted keys and reports count", async () => {
  const fs = require("fs");
  const { dialog } = require("electron");
  const tmp = path.join(require("os").tmpdir(), `mix-${Date.now()}.json`);
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      theme: "dark", // allowed
      malicious_key: "x", // disallowed
      ai_model: "gpt-4", // allowed
    }),
  );
  dialog.showOpenDialog.mockResolvedValueOnce({
    canceled: false,
    filePaths: [tmp],
  });
  const handler = ipcMain._handlers["import-settings"];
  const result = await handler({});
  expect(result.success).toBe(true);
  expect(result.count).toBe(2); // theme + ai_model
  expect(managers.databaseManager.setSetting).toHaveBeenCalledWith(
    "theme",
    "dark",
  );
  expect(managers.databaseManager.setSetting).toHaveBeenCalledWith(
    "ai_model",
    "gpt-4",
  );
  expect(managers.databaseManager.setSetting).not.toHaveBeenCalledWith(
    "malicious_key",
    expect.anything(),
  );
  fs.unlinkSync(tmp);
});
```

### 6.3 `validateSetting` rejects oversized / unknown keys

**File**: `src/helpers/ipc/settingsHandlers.ts:61-67`
**Current coverage**: not tested (the function is exported but never asserted on).
**Trigger**: key longer than 100 chars, or unknown key, or value >10000 chars.
**Expected behavior**: returns `false`.
**Test case**:

```js
const { validateSetting } = require("../../src/helpers/ipc/settingsHandlers");
test("validateSetting rejects unknown keys", () => {
  expect(validateSetting("malicious", "x")).toBe(false);
});
test("validateSetting rejects overly long key names", () => {
  expect(validateSetting("a".repeat(101), "x")).toBe(false);
});
test("validateSetting rejects overly long string values", () => {
  expect(validateSetting("theme", "x".repeat(10001))).toBe(false);
});
test("validateSetting accepts allowlisted key with valid value", () => {
  expect(validateSetting("theme", "dark")).toBe(true);
});
test("validateSetting rejects non-string key", () => {
  expect(validateSetting(42, "x")).toBe(false);
});
```

### 6.4 SET handler returns error on invalid setting

**File**: `src/helpers/ipc/settingsHandlers.ts:86-94`
**Current coverage**: not tested.
**Trigger**: `set-setting` with key `"bad_key"`.
**Expected behavior**: `{ success: false, error: "Invalid setting key or value" }`
and `setSetting` not called.
**Test case**:

```js
test("SET handler rejects invalid key without writing", () => {
  const result = ipcMain._handlers["set-setting"]({}, "bad_key", "x");
  expect(result.success).toBe(false);
  expect(result.error).toContain("Invalid");
  expect(managers.databaseManager.setSetting).not.toHaveBeenCalled();
});
```

### 6.5 Encryption unavailable → plaintext fallback round-trip

**File**: `src/helpers/database.ts:75-84` (the `!isEncryptionAvailable` branch)
**Current coverage**: the existing test covers the case where safeStorage is not
_set_. The case where safeStorage IS set but `isEncryptionAvailable()` returns
`false` is not directly asserted as a round-trip for `ai_api_key`.
**Trigger**: safeStorage present but `isEncryptionAvailable() === false`.
**Expected behavior**: `ai_api_key` stored as plaintext JSON, read back correctly.
**Test case**:

```js
test("ai_api_key round-trips as plaintext when encryption unavailable", () => {
  process.env.MURMUR_DB_PATH = ":memory:";
  const db = new DatabaseManager();
  db.initialize(tmpDir);
  const ss = {
    isEncryptionAvailable: () => false,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  };
  db.setSafeStorage(ss);
  db.setSetting("ai_api_key", "plaintext-secret");
  expect(ss.encryptString).not.toHaveBeenCalled();
  expect(db.getSetting("ai_api_key")).toBe("plaintext-secret");
  db.close();
});
```

### 6.6 Schema migration from v0 with no api key (no-op)

**File**: `src/helpers/database.ts:265-290`
**Current coverage**: the migration runs but the v1 branch where there is **no**
`ai_api_key` row (fresh install) is not explicitly asserted.
**Trigger**: fresh DB, set safeStorage, version is 0, no api key stored.
**Expected behavior**: migration completes, version becomes 1, no encrypt call.
**Test case**:

```js
test("_migrateSettings v0→v1 is a no-op when no api key is stored", () => {
  process.env.MURMUR_DB_PATH = ":memory:";
  const db = new DatabaseManager();
  db.initialize(tmpDir);
  const ss = {
    isEncryptionAvailable: () => true,
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  };
  db.setSafeStorage(ss);
  ss.encryptString.mockClear();
  // Trigger again — should be idempotent and not encrypt anything
  db.setSetting("settings_schema_version", 0);
  db._migrateSettings();
  expect(db.getSetting("settings_schema_version")).toBe(1);
  // encryptString only called for settings_schema_version if it were an encrypted key (it isn't)
  db.close();
});
```

---

## 7. Update manager edge cases

**File**: `src/helpers/updateManager.ts`
**Current coverage**: `updateManager-behavioral.test.ts` covers `semverGt`,
`parseChecksums`, `getPlatformAsset` (pure helpers). **The IPC handlers (CHECK,
DOWNLOAD, INSTALL, CANCEL) are entirely untested** because they require the
Electron `net.fetch` / `app` / `shell` mocks.

### 7.1 CHECK: GitHub API returns non-ok (rate limited / network down)

**File**: `src/helpers/updateManager.ts:105-146` (line 109-111)
**Current coverage**: not tested.
**Trigger**: `net.fetch` resolves with `{ ok: false, status: 403 }` (GitHub
rate limit) or rejects (network down).
**Expected behavior**: returns `{ hasUpdate: false, currentVersion, error:
"无法检查更新" }`.
**Test case**:

```js
test("CHECK returns error when GitHub API is not ok (rate limited)", async () => {
  const { net, app } = require("electron");
  net.fetch.mockResolvedValueOnce({ ok: false, status: 403 });
  app.getVersion.mockReturnValue("1.0.0");
  const { register } = await import("../../src/helpers/updateManager");
  const ipc = { handle: vi.fn((ch, fn) => handlers.set(ch, fn)) };
  register(ipc, { logger: { warn: vi.fn() } });
  const C = await import("../../src/helpers/ipc-contracts");
  const result = await handlers.get(C.UPDATE.CHECK)();
  expect(result.hasUpdate).toBe(false);
  expect(result.error).toContain("无法检查");
});
```

### 7.2 CHECK: malformed release payload (no tag_name)

**File**: `src/helpers/updateManager.ts:113-119`
**Current coverage**: not tested.
**Trigger**: `response.json()` returns `{}` or `{ message: "Not Found" }`.
**Expected behavior**: `{ hasUpdate: false, error: "更新信息格式异常" }`.
**Test case**:

```js
test("CHECK returns format error when release has no tag_name", async () => {
  const { net, app } = require("electron");
  net.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ message: "Not Found" }),
  });
  app.getVersion.mockReturnValue("1.0.0");
  // ... register + call UPDATE.CHECK ...
  expect(result.hasUpdate).toBe(false);
  expect(result.error).toContain("格式异常");
});
```

### 7.3 DOWNLOAD: SHA256 mismatch deletes file and errors

**File**: `src/helpers/updateManager.ts:239-243`
**Current coverage**: `verifySHA256` is exportable but the mismatch path inside
DOWNLOAD is not tested.
**Trigger**: downloaded file's hash ≠ expected hash from checksums.
**Expected behavior**: file is `unlinkSync`'d, returns `{ success: false, error:
"SHA256 校验失败" }`.
**Test case**:

```js
test("DOWNLOAD deletes file and errors on SHA256 mismatch", async () => {
  // Mock net.fetch for checksums + installer, crypto to return wrong hash
  const { net } = require("electron");
  const crypto = require("crypto");
  // checksums file
  net.fetch.mockImplementationOnce(async () => ({
    ok: true,
    text: async () => `${"a".repeat(64)}  Murmur-1.0.0.dmg`,
  }));
  // installer stream
  net.fetch.mockImplementationOnce(async () => ({
    ok: true,
    headers: { get: () => "100" },
    body: { getReader: () => ({ read: vi.fn(async () => ({ done: true })) }) },
  }));
  // verifySHA256 computes real hash → won't equal "aaa..."
  // ... wire event.sender, call UPDATE.DOWNLOAD with updateInfo ...
  const result = await handlers.get(C.UPDATE.DOWNLOAD)(mockEvent, {
    downloadUrl: "http://x/dmg",
    checksumsUrl: "http://x/sha",
    latestVersion: "1.0.0",
  });
  expect(result.success).toBe(false);
  expect(result.error).toContain("SHA256");
  expect(fs.existsSync(filePath)).toBe(false);
});
```

### 7.4 DOWNLOAD: checksums file missing the platform asset entry

**File**: `src/helpers/updateManager.ts:183-188`
**Current coverage**: not tested.
**Trigger**: checksums file has no line for `Murmur-1.0.0.dmg`.
**Expected behavior**: throws `"校验文件中未找到对应文件"`.
**Test case**:

```js
test("DOWNLOAD errors when checksums file lacks the platform asset", async () => {
  const { net } = require("electron");
  net.fetch.mockImplementationOnce(async () => ({
    ok: true,
    text: async () => `${"b".repeat(64)}  Other-1.0.0.dmg`,
  }));
  const result = await handlers.get(C.UPDATE.DOWNLOAD)(mockEvent, {
    downloadUrl: "http://x/dmg",
    checksumsUrl: "http://x/sha",
    latestVersion: "1.0.0",
  });
  expect(result.success).toBe(false);
  expect(result.error).toContain("未找到");
});
```

### 7.5 DOWNLOAD: missing downloadUrl / checksumsUrl / latestVersion

**File**: `src/helpers/updateManager.ts:155-161`
**Current coverage**: not tested.
**Trigger**: `updateInfo` is `{}`.
**Expected behavior**: `{ success: false, error: "缺少下载信息" }`.
**Test case**:

```js
test("DOWNLOAD rejects when updateInfo is missing fields", async () => {
  const result = await handlers.get(C.UPDATE.DOWNLOAD)(mockEvent, {});
  expect(result.success).toBe(false);
  expect(result.error).toContain("缺少");
});
```

### 7.6 DOWNLOAD: concurrent download rejected

**File**: `src/helpers/updateManager.ts:151-153`
**Current coverage**: not tested.
**Trigger**: call DOWNLOAD twice without the first finishing.
**Expected behavior**: second call returns `{ success: false, error: "已有下载进行中" }`.
**Test case**:

```js
test("DOWNLOAD rejects concurrent download", async () => {
  const { net } = require("electron");
  // First call: make checksums fetch hang
  net.fetch.mockImplementationOnce(() => new Promise(() => {}));
  const p1 = handlers.get(C.UPDATE.DOWNLOAD)(mockEvent, validUpdateInfo);
  const result2 = await handlers.get(C.UPDATE.DOWNLOAD)(
    mockEvent,
    validUpdateInfo,
  );
  expect(result2.success).toBe(false);
  expect(result2.error).toContain("进行中");
  // cleanup
  await p1.catch(() => {});
});
```

### 7.7 INSTALL: path traversal outside temp dir rejected

**File**: `src/helpers/updateManager.ts:295-306`
**Current coverage**: not tested.
**Trigger**: `filePath = "/Applications/evil.app"` or `"../../evil"`.
**Expected behavior**: returns `false`, does not call `shell.openPath`.
**Test case**:

```js
test("INSTALL rejects path outside temp directory", async () => {
  const { app, shell } = require("electron");
  app.getPath.mockReturnValue("/tmp");
  const result = await handlers.get(C.UPDATE.INSTALL)(
    mockEvent,
    "/Applications/evil.app",
  );
  expect(result).toBe(false);
  expect(shell.openPath).not.toHaveBeenCalled();
});
```

### 7.8 INSTALL: non-string filePath rejected

**File**: `src/helpers/updateManager.ts:296`
**Current coverage**: not tested.
**Trigger**: `filePath = null` / `undefined` / `42`.
**Expected behavior**: returns `false`.
**Test case**:

```js
test.each([null, undefined, 42, ""])(
  "INSTALL rejects non-string filePath (%s)",
  async (v) => {
    const result = await handlers.get(C.UPDATE.INSTALL)(mockEvent, v);
    expect(result).toBe(false);
  },
);
```

### 7.9 CANCEL: no active download

**File**: `src/helpers/updateManager.ts:287-293`
**Current coverage**: not tested.
**Trigger**: call CANCEL when no download is in progress.
**Expected behavior**: `{ success: false, error: "没有进行中的下载" }`.
**Test case**:

```js
test("CANCEL returns error when no download active", async () => {
  const result = await handlers.get(C.UPDATE.CANCEL)();
  expect(result.success).toBe(false);
  expect(result.error).toContain("没有");
});
```

### 7.10 CANCEL mid-download unlinks partial file

**File**: `src/helpers/updateManager.ts:206-212`
**Current coverage**: not tested.
**Trigger**: set `currentDownload.cancelled = true` during the read loop.
**Expected behavior**: partial file deleted, returns `{ success: false, error:
"下载已取消" }`.
**Test case**:

```js
test("CANCEL during download deletes partial file and aborts", async () => {
  const fs = require("fs");
  const { net } = require("electron");
  net.fetch.mockImplementationOnce(async () => ({
    ok: true,
    text: async () => `${"a".repeat(64)}  Murmur-1.0.0.dmg`,
  }));
  net.fetch.mockImplementationOnce(async () => ({
    ok: true,
    headers: { get: () => "1000" },
    body: {
      getReader: () => ({
        read: vi.fn(async () => {
          // Trigger cancel on first read
          await handlers.get(C.UPDATE.CANCEL)();
          return { done: false, value: new Uint8Array([1, 2, 3]) };
        }),
      }),
    },
  }));
  const result = await handlers.get(C.UPDATE.DOWNLOAD)(
    mockEvent,
    validUpdateInfo,
  );
  expect(result.success).toBe(false);
  expect(result.error).toContain("取消");
  expect(fs.existsSync(filePath)).toBe(false);
});
```

### 7.11 `verifySHA256` on non-existent file rejects

**File**: `src/helpers/updateManager.ts:85-99`
**Current coverage**: not tested.
**Trigger**: pass a path that doesn't exist.
**Expected behavior**: the read stream emits `error` → promise rejects.
**Test case**:

```js
const { verifySHA256 } = require("../../src/helpers/updateManager");
test("verifySHA256 rejects for non-existent file", async () => {
  await expect(verifySHA256("/non/existent", "abc")).rejects.toThrow();
});
```

### 7.12 `semverGt` with malformed versions

**File**: `src/helpers/updateManager.ts:45-53`
**Current coverage**: the existing test covers well-formed versions. Malformed
input (`"v1.0"`, `"abc"`, `"1.0.0-beta"`) is not tested.
**Trigger**: a tag like `"v1.0.0-beta"`.
**Expected behavior**: `Number("0-beta")` → NaN → `NaN || 0 === 0`; the
comparison treats the pre-release as `.0`. Test documents this.
**Test case**:

```js
test.each([
  ["1.0", "1.0.0", false, "short version pads with 0"],
  ["v1.0.0", "1.0.0", false, "leading v ignored by Number coercion"],
  ["1.0.0-beta", "1.0.0", false, "pre-release suffix coerces to 0"],
  ["abc", "0.0.1", false, "garbage becomes 0.0.0"],
])("semverGt(%s, %s) === %s (%s)", (a, b, expected) => {
  expect(semverGt(a, b)).toBe(expected);
});
```

---

## 8. Implementation priority & coverage impact

Ranked by (coverage lift × bug-severity × ease-of-implementation):

| Priority | Test group                  | Files touched                         | Estimated branch lift                       | Severity                                 |
| -------- | --------------------------- | ------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| **P0**   | 1.1–1.10 (database)         | `database.ts`                         | **+18-22%** branches (67% → ~86%)           | High — data loss / corruption            |
| **P0**   | 7.1–7.10 (update IPC)       | `updateManager.ts`                    | Brings 0% → ~80% on IPC handlers            | High — auto-update is a security surface |
| **P1**   | 2.1–2.7 (transcription)     | `transcriptionHandlers.ts`            | ~0% report (excluded) but real bug surface  | High — user-facing                       |
| **P1**   | 3.1–3.10 (funasr lifecycle) | `funasrServer.ts`, `funasrManager.ts` | Moderate; mostly spawn/timer branches       | High — silent failures                   |
| **P2**   | 4.1–4.6 (ai handler)        | `aiHandlers.ts`                       | Moderate; timeout/network branches          | Medium                                   |
| **P2**   | 5.1–5.6 (audio path)        | `audioPathValidator.ts`               | **75% → ~95%** branches (security-critical) | High — path traversal                    |
| **P3**   | 6.1–6.6 (settings)          | `settingsHandlers.ts`                 | Moderate                                    | Medium                                   |

### Coverage threshold impact

The current branch threshold (88%) is failing at **75.19%**, primarily because
`database.ts` (67.18%) and `fileConfig.ts` (63.63%) drag the average down.
Implementing the **P0 database tests (section 1) alone** is projected to lift
`database.ts` branches from 67% to ~85-88%, which would bring the aggregate
across the threshold without touching any other file. Section 7 (update manager)
is the highest _new_ coverage since those handlers are currently at 0%.

### Mock setup conventions (shared)

Most tests above assume the following harness, consistent with existing tests:

```js
// electron mock (top of file, before imports)
vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "1.0.0"),
    getPath: vi.fn(() => "/tmp"),
    quit: vi.fn(),
  },
  shell: { openPath: vi.fn() },
  net: { fetch: vi.fn() },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  Notification: { isSupported: vi.fn(() => false) },
}));

// better-sqlite3 mock when testing initialize() error paths
vi.mock("better-sqlite3", () => {
  const fn = vi.fn(() => ({
    pragma: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(), run: vi.fn() })),
    close: vi.fn(),
    backup: vi.fn(),
  }));
  return { default: fn, __esModule: true };
});

// child_process mock for funasrServer spawn paths
vi.mock("child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

// DB isolation
process.env.MURMUR_DB_PATH = ":memory:"; // in beforeEach
```

### Notes on behavior discovered during analysis

1. **`database.ts` `_encryptValue` does not catch `encryptString` failures** (section
   1.9). If the OS keyring is locked, `setSetting("ai_api_key", ...)` will throw
   and the user's setting won't persist. A plaintext fallback should be
   considered.

2. **`audioPathValidator.ts` is bypassable via symlinks** (section 5.6).
   `path.resolve` does not resolve symlinks, so a symlink inside `homedir`
   pointing to `/etc/passwd.wav` passes validation. Recommend switching to
   `fs.realpathSync` and re-checking the resolved root.

3. **`updateManager.ts` INSTALL handler** (section 7.7) correctly guards against
   path traversal (`resolved.startsWith(tmpDir)`), but the guard is only as good
   as `app.getPath("temp")` — worth a dedicated test.

4. **`funasrServer.ts` health monitor** (section 3.6) calls `_handleServerCrash`
   on ping failure but does not clear `serverProcess` first, so the restart path
   re-uses a possibly-dead process reference. The crash handler itself nulls it,
   but the ordering is subtle and worth a regression test.

5. **`transcriptionHandlers.ts` AI_REVIEW** (section 2.7) uses
   `processTextWithAI!` (non-null assertion). If `register` is called without
   `processTextWithAI`, the handler throws `TypeError` at call time — caught and
   returned as a generic error. Consider an explicit guard at registration.
