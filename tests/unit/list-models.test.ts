// [20260907_Feat_233_ListModels] TDD tests for Spec #193 T6 (ticket #233):
// provider model-list auto-derivation over a NEW GET network primitive.
// Security constraints are acceptance-hard: the endpoint is derived with the
// URL constructor only (no whole-URL string concat), the request passes the
// SAME SSRF validation as the chat request (private https rejected,
// localhost/local-gateway exception allowed), and malformed provider
// responses silently fall back to the manual-input path.
//
// Harness mirrors aiHandlers.test.ts (captureHandlers-style registration +
// fetch mock + real node:sqlite DB for the masked-key fallback).
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

const spawnMock = vi.hoisted(() => vi.fn());
// database.ts lazily requires node:sqlite through the real driver — keep the
// default import and only mock child_process for the (unused) spawn path.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

if (!process.resourcesPath) {
  Object.assign(process, { resourcesPath: "/fake/resources" });
}
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/fake-userdata"),
    getAppPath: vi.fn(() => "/fake/app"),
  },
}));

import os from "os";
import path from "path";
import DatabaseManager from "../../src/helpers/database";
import * as aiHandlersNS from "../../src/helpers/ipc/aiHandlers";
import * as C from "../../src/helpers/ipc-contracts";

const FetchMock = fetchMock as unknown as ReturnType<typeof vi.fn>;

function loggerOf() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function respond(body: unknown, status = 200) {
  FetchMock.mockImplementationOnce(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
}

let db: DatabaseManager;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "list-models-db-"));
  db = new DatabaseManager();
  db.initialize(tmpDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function setup() {
  vi.resetModules();
  const register = aiHandlersNS.register;
  const captured: Record<string, (...args: unknown[]) => unknown> = {};
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      captured[channel] = handler;
    },
  };
  register(
    ipcMain as never,
    {
      databaseManager: db,
      funasrManager: null,
      processTextWithAI: vi.fn(),
      windowManager: { mainWindow: null },
      logger: loggerOf(),
      templatesDir: "/tmp/test-templates",
    } as never,
  );
  return {
    db,
    handler: captured[C.AI.LIST_MODELS]!,
    logger: undefined as unknown as ReturnType<typeof loggerOf>,
  };
}

function modelsBody(ids: unknown[]): unknown {
  return { object: "list", data: ids.map((id) => ({ id, object: "model" })) };
}

describe("[20260907_Feat_233_ListModels] LIST_MODELS handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FetchMock.mockReset();
  });

  it("derives {base}/models for a v1-prefixed base and returns model ids", async () => {
    const { handler, db } = await setup();
    db.setSetting("ai_api_key", "sk-live");
    respond(modelsBody(["gpt-x", "gpt-y"]));

    const result = (await handler(
      {},
      "https://api.example.com/v1",
      "sk-live",
    )) as { success: boolean; models: string[] };

    expect(result.success).toBe(true);
    expect(result.models).toEqual(["gpt-x", "gpt-y"]);
    const [url, init] = FetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://api.example.com/v1/models");
    expect(init.headers.Authorization).toBe("Bearer sk-live");
  });

  it("retries /v1/models when the base has no version prefix and /models 404s", async () => {
    const { handler } = await setup();
    respond("Not Found", 404);
    respond(modelsBody(["m-1"]));

    const result = (await handler({}, "https://api.example.com", "sk")) as {
      success: boolean;
      models: string[];
    };

    expect(result.success).toBe(true);
    expect(result.models).toEqual(["m-1"]);
    expect(FetchMock.mock.calls[0]![0]).toBe("https://api.example.com/models");
    expect(FetchMock.mock.calls[1]![0]).toBe(
      "https://api.example.com/v1/models",
    );
  });

  it("keeps an explicit non-v1 path as-is (only /models appended)", async () => {
    const { handler } = await setup();
    respond(modelsBody(["m"]));

    await handler({}, "https://gateway.example.com/api", "k");
    expect(FetchMock.mock.calls[0]![0]).toBe(
      "https://gateway.example.com/api/models",
    );
  });

  it("rejects a private-network https base with the same SSRF params (no fetch)", async () => {
    const { handler } = await setup();
    const result = (await handler({}, "https://10.0.0.5/v1", "k")) as {
      success: boolean;
      models: string[];
    };

    expect(result.success).toBe(false);
    expect(result.models).toEqual([]);
    expect(FetchMock).not.toHaveBeenCalled();
  });

  it("allows the localhost exception for local gateways (http)", async () => {
    const { handler } = await setup();
    respond(modelsBody(["llama-local"]));

    const result = (await handler({}, "http://localhost:11434/v1", "")) as {
      success: boolean;
      models: string[];
    };

    expect(result.success).toBe(true);
    expect(result.models).toEqual(["llama-local"]);
    // No key → no Authorization header.
    const [, init] = FetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers.Authorization).toBeUndefined();
  });

  // [20260907_Fix_233_SsrfHardening] Security-review MEDIUM: the shared gate
  // had IPv6/CGNAT blind spots — these URLs passed as "public https" while
  // resolving to private/internal addresses. All must be rejected.
  it.each([
    ["https://[::ffff:10.0.0.1]/v1"], // IPv4-mapped IPv6 → 10.0.0.1
    ["https://[::ffff:127.0.0.1]/v1"], // mapped loopback
    ["https://[fd00::1]/v1"], // IPv6 ULA fc00::/7
    ["https://[fe80::1]/v1"], // IPv6 link-local
    ["https://100.64.0.1/v1"], // CGNAT 100.64.0.0/10
    ["https://198.18.0.1/v1"], // benchmark range
  ])("rejects the internal-address base %s", async (base) => {
    const { handler } = await setup();
    const result = (await handler({}, base, "k")) as {
      success: boolean;
      models: string[];
    };
    expect(result.success).toBe(false);
    expect(result.models).toEqual([]);
    expect(FetchMock).not.toHaveBeenCalled();
  });

  it("still accepts legit public providers after the hardening", async () => {
    const { handler } = await setup();
    respond(modelsBody(["m"]));
    const result = (await handler({}, "https://api.example.com/v1", "k")) as {
      success: boolean;
    };
    expect(result.success).toBe(true);
  });

  it("falls back silently when an id is not a string", async () => {
    const { handler } = await setup();
    respond(modelsBody(["good", 42]));

    const result = (await handler({}, "https://api.example.com/v1", "k")) as {
      success: boolean;
    };
    expect(result.success).toBe(false);
  });

  it("falls back silently beyond the 500-item cap", async () => {
    const { handler } = await setup();
    respond(modelsBody(Array.from({ length: 501 }, (_, i) => `m-${i}`)));

    const result = (await handler({}, "https://api.example.com/v1", "k")) as {
      success: boolean;
    };
    expect(result.success).toBe(false);
  });

  it("falls back silently when the body exceeds the byte cap", async () => {
    const { handler } = await setup();
    // One huge id → body above the total byte cap.
    respond(modelsBody(["x".repeat(700_000)]));

    const result = (await handler({}, "https://api.example.com/v1", "k")) as {
      success: boolean;
    };
    expect(result.success).toBe(false);
  });

  it("falls back silently when the provider fetch fails", async () => {
    const { handler } = await setup();
    FetchMock.mockRejectedValueOnce(new Error("network down"));

    const result = (await handler({}, "https://api.example.com/v1", "k")) as {
      success: boolean;
    };
    expect(result.success).toBe(false);
  });

  it("resolves a masked key through the stored setting", async () => {
    const { handler, db } = await setup();
    db.setSetting("ai_api_key", "sk-stored");
    respond(modelsBody(["m"]));

    await handler({}, "https://api.example.com/v1", "****abcd");

    const [, init] = FetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers.Authorization).toBe("Bearer sk-stored");
  });
});

describe("[20260907_Feat_233_ListModels] rate limit + contract pin", () => {
  it("declares the LIST_MODELS channel in the rate-limit table", async () => {
    // Meta-pin per the ticket AC (小额配额): the channel must carry a rate
    // limit entry in the shared registration table.
    const source = fs.readFileSync("src/helpers/ipc/index.ts", "utf8");
    expect(source).toContain("C.AI.LIST_MODELS");
    expect(source).toMatch(/LIST_MODELS.*maxCalls/i);
  });

  it("declares the channel constant in ipc-contracts", () => {
    expect(C.AI.LIST_MODELS).toBe("ai-list-models");
  });
});
