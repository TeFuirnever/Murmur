// [20260912_Feat_242_TemplateSystem] TDD for ticket #242 (spec #193 T15):
// the template IPC handler module + the aiHandlers template-cache
// invalidation contract. The handlers are thin shells over
// templatesService; the interesting assertions are the AC ones:
//   (a) only name+content cross the boundary (a traversal name is
//       rejected by the sanitizer, nothing is written outside the dir);
//   (b) a successful save invalidates aiHandlers' 30s TTL template cache
//       so an immediate GET_MODES reflects the new template;
//   (c) a polish run with the new custom mode actually sends the
//       template's system prompt to the provider;
//   (d) deleting a shadowing template restores the built-in mode in
//       GET_MODES immediately (same invalidation, restore-default arm).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Same lazy-require shim as aiHandlers.test.ts: the fallback
// require("electron") in register() never runs here (tests pass
// templatesDir explicitly), but the mock keeps the module import safe.
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/test-user-data"),
  },
}));

import * as templateHandlers from "../../src/helpers/ipc/templateHandlers";
import * as aiHandlersNS from "../../src/helpers/ipc/aiHandlers";
import * as C from "../../src/helpers/ipc-contracts";

type AsyncMockHandler = (...args: unknown[]) => unknown;

// Handle-capturing ipcMain mock (same pattern as aiHandlers.test.ts).
function captureHandlers(
  registerFn: (ipcMain: never, managers: never) => void,
  managers: unknown,
) {
  const handlers: Record<string, AsyncMockHandler | undefined> = {};
  const ipcMain = {
    handle: vi.fn((channel: string, fn: AsyncMockHandler) => {
      handlers[channel] = fn;
    }),
  };
  (registerFn as unknown as (ipc: unknown, managers: unknown) => void)(
    ipcMain,
    managers,
  );
  return { handlers, ipcMain };
}

interface FetchResponseStub {
  ok: boolean;
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

type FetchMock = ReturnType<
  typeof vi.fn<(input: unknown, init?: unknown) => Promise<FetchResponseStub>>
>;

function mockFetch(response: unknown): FetchMock {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  })) as FetchMock;
  global.fetch = fn as unknown as typeof global.fetch;
  return fn;
}

// Settings stub with the AI config the polish orchestrator resolves.
function makeDb(): { getSetting: (key: string) => Promise<unknown> } {
  const settings: Record<string, string | number> = {
    ai_api_key: "test-key",
    ai_base_url: "https://api.openai.com/v1",
    ai_model: "gpt-3.5-turbo",
    ai_temperature: 0.3,
    ai_max_tokens: 2000,
  };
  return {
    getSetting: vi.fn(async (key: string) => settings[key] ?? null),
  };
}

function makeManagers(): Record<string, unknown> {
  return {
    databaseManager: makeDb(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    templatesDir: tmpDir,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "template-handlers-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("[20260912_Feat_242_TemplateSystem] templateHandlers", () => {
  it("registers LIST/READ/SAVE/DELETE through the contract constants", () => {
    const { ipcMain } = captureHandlers(
      templateHandlers.register,
      makeManagers(),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      C.TEMPLATES.LIST,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      C.TEMPLATES.READ,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      C.TEMPLATES.SAVE,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      C.TEMPLATES.DELETE,
      expect.any(Function),
    );
  });

  it("LIST returns the parsed custom templates", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "meeting.md"),
      "---\nname: meeting\nlabel: 会议纪要\n---\n会议助手。",
    );
    const { handlers } = captureHandlers(
      templateHandlers.register,
      makeManagers(),
    );
    const result = (await handlers[C.TEMPLATES.LIST]!()) as {
      success: boolean;
      templates: Array<{ name: string; label: string; fileName: string }>;
    };
    expect(result.success).toBe(true);
    // [20260912_Fix_242_ReviewRound2] LIST carries the on-disk fileName so
    // the read/save/delete operations can key off it.
    expect(result.templates).toEqual([
      { name: "meeting", label: "会议纪要", fileName: "meeting.md" },
    ]);
  });

  it("READ returns the file content by name", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "meeting.md"),
      "---\nname: meeting\n---\n正文 {text}",
    );
    const { handlers } = captureHandlers(
      templateHandlers.register,
      makeManagers(),
    );
    const result = (await handlers[C.TEMPLATES.READ]!({}, "meeting.md")) as {
      success: boolean;
      content?: string;
    };
    expect(result.success).toBe(true);
    expect(result.content).toBe("---\nname: meeting\n---\n正文 {text}");
  });

  // [20260912_Fix_242_ReviewRound2] Identity regression at the IPC level:
  // frontmatter name ≠ file stem. LIST must expose the on-disk fileName
  // and READ/SAVE/DELETE must key off it, or the editor 404s an existing
  // template, SAVE duplicates it and DELETE silently no-ops.
  it("LIST/READ/SAVE/DELETE key off the on-disk fileName when stem ≠ frontmatter name", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "custom.md"),
      "---\nname: meeting-notes\nlabel: 会议纪要\n---\n正文",
    );
    const { handlers } = captureHandlers(
      templateHandlers.register,
      makeManagers(),
    );

    const listed = (await handlers[C.TEMPLATES.LIST]!()) as {
      success: boolean;
      templates: Array<{ name: string; label: string; fileName: string }>;
    };
    expect(listed.templates).toEqual([
      { name: "meeting-notes", label: "会议纪要", fileName: "custom.md" },
    ]);

    const read = (await handlers[C.TEMPLATES.READ]!({}, "custom.md")) as {
      success: boolean;
    };
    expect(read.success).toBe(true);

    const saved = (await handlers[C.TEMPLATES.SAVE]!(
      {},
      "custom.md",
      "updated",
    )) as { success: boolean; fileName?: string };
    expect(saved.success).toBe(true);
    expect(fs.readdirSync(tmpDir).filter((f) => f.endsWith(".md"))).toEqual([
      "custom.md",
    ]);

    const deleted = (await handlers[C.TEMPLATES.DELETE]!({}, "custom.md")) as {
      success: boolean;
    };
    expect(deleted.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "custom.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "meeting-notes.md"))).toBe(false);
  });

  it("SAVE never persists a client-supplied traversal name", async () => {
    const { handlers } = captureHandlers(
      templateHandlers.register,
      makeManagers(),
    );
    const result = (await handlers[C.TEMPLATES.SAVE]!(
      {},
      "../evil",
      "boom",
    )) as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    // Nothing outside the templates dir was written.
    expect(fs.existsSync(path.join(tmpDir, "..", "evil.md"))).toBe(false);
  });

  // AC (b): save → immediate GET_MODES reflects the new template. The
  // aiHandlers cache is primed FIRST so this fails while the save handler
  // skips the invalidation (the 30s TTL would serve the stale list).
  it("save invalidates the template cache so GET_MODES reflects the new template immediately", async () => {
    const managers = makeManagers();
    const ai = captureHandlers(aiHandlersNS.register, managers).handlers;
    const tpl = captureHandlers(templateHandlers.register, managers).handlers;

    const before = (await ai[C.AI.GET_MODES]!()) as Array<{ name: string }>;
    expect(before.some((m) => m.name === "fresh")).toBe(false);

    const saved = (await tpl[C.TEMPLATES.SAVE]!(
      {},
      "fresh",
      "---\nname: fresh\nlabel: 新模板\n---\n正文",
    )) as { success: boolean };
    expect(saved.success).toBe(true);

    const after = (await ai[C.AI.GET_MODES]!()) as Array<{ name: string }>;
    expect(after.some((m) => m.name === "fresh")).toBe(true);
  });

  // AC (c): a polish run with the new custom mode uses it — the system
  // message sent to the provider IS the saved template's body.
  it("a polish run with the saved mode sends the template's system prompt", async () => {
    const managers = makeManagers();
    const ai = captureHandlers(aiHandlersNS.register, managers).handlers;
    const tpl = captureHandlers(templateHandlers.register, managers).handlers;

    await tpl[C.TEMPLATES.SAVE]!(
      {},
      "fresh",
      "---\nname: fresh\nlabel: 新模板\n---\n自定义系统提示词",
    );

    const fetchMock = mockFetch({
      choices: [{ message: { content: "ok" } }],
    });
    const result = (await ai[C.AI.PROCESS]!({}, "raw text", "fresh")) as {
      success: boolean;
    };
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as { body: string }).body,
    );
    expect(body.messages[0].content).toBe("自定义系统提示词");
  });

  // AC (d): restore-default symmetry — deleting the shadowing file makes
  // the built-in mode reappear in GET_MODES without waiting out the TTL.
  it("delete invalidates the cache so a shadowed built-in mode is restored immediately", async () => {
    const managers = makeManagers();
    const ai = captureHandlers(aiHandlersNS.register, managers).handlers;
    const tpl = captureHandlers(templateHandlers.register, managers).handlers;

    await tpl[C.TEMPLATES.SAVE]!(
      {},
      "optimize",
      "---\nname: optimize\nlabel: 影子\n---\n覆盖内置",
    );
    const shadowed = (await ai[C.AI.GET_MODES]!()) as Array<{
      name: string;
      label: string;
    }>;
    expect(shadowed.some((m) => m.name === "optimize")).toBe(true);
    expect(shadowed.find((m) => m.name === "optimize")!.label).toBe("影子");

    const deleted = (await tpl[C.TEMPLATES.DELETE]!({}, "optimize")) as {
      success: boolean;
    };
    expect(deleted.success).toBe(true);

    const restored = (await ai[C.AI.GET_MODES]!()) as Array<{
      name: string;
      label: string;
    }>;
    const optimize = restored.find((m) => m.name === "optimize");
    expect(optimize).toBeDefined();
    expect(optimize!.label).toBe("智能润色");
  });
});
