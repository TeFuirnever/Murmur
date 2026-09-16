// [20260912_Feat_271_McpInstall] Function-level convention tests for
// `murmur mcp install` (ticket #271). All paths derive from an injected
// `cwd` pointing at a per-test temp directory — NO real home-dir or repo
// writes. Locked here:
//   - fresh install content per client, including VS Code's "servers"
//     top-level key difference (Claude Code/Cursor use "mcpServers")
//   - idempotency: a second identical run reports 无变化 and leaves the
//     original file bytes untouched
//   - merge semantics: only the "murmur" entry is added/replaced; foreign
//     server entries and unrelated top-level keys survive
//   - invalid existing JSON → exit 1, file left byte-for-byte untouched
//   - scope/client/flag validation (--user honestly unsupported → usage 2)
//   - the locked --json schema { clients: [...] }
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runCli,
  EXIT_OK,
  EXIT_RUNTIME_ERROR,
  EXIT_USAGE_ERROR,
} from "../../cli/lib/cliRunner.mjs";

// The canonical server entry every client config receives (ticket #269:
// `<cli> mcp` under ELECTRON_RUN_AS_NODE is the client-facing command).
const CANONICAL_MURMUR_ENTRY = { command: "murmur", args: ["mcp"] };

const CLAUDE_RELATIVE_PATH = ".mcp.json";
const CURSOR_RELATIVE_PATH = path.join(".cursor", "mcp.json");
const VSCODE_RELATIVE_PATH = path.join(".vscode", "mcp.json");

let tempDir: string | null = null;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "murmur-mcp-install-"));
}

function currentTempDir(): string {
  if (tempDir === null) throw new Error("temp dir not initialised");
  return tempDir;
}

afterEach(() => {
  if (tempDir !== null) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

/** runCli(`murmur mcp install ...`) against the per-test temp cwd. */
function runInstall(argv: string[] = [], options: { json?: boolean } = {}) {
  const args = options.json ? [...argv, "--json"] : argv;
  return runCli(["mcp", "install", ...args], {
    cwd: currentTempDir(),
    // Never let path resolution fall through to the real user directories.
    configPath: path.join(currentTempDir(), "unused-murmur.json"),
    dbPath: path.join(currentTempDir(), "unused-transcriptions.db"),
  });
}

function writeConfigFile(relativePath: string, content: string): void {
  const absolutePath = path.join(currentTempDir(), relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf-8");
}

function readRawConfigFile(relativePath: string): string {
  return fs.readFileSync(path.join(currentTempDir(), relativePath), "utf-8");
}

describe("mcp install: fresh install content (three clients)", () => {
  it("default (all) writes all three config files with the canonical murmur entry", () => {
    tempDir = makeTempDir();
    const result = runInstall();

    expect(result.code).toBe(EXIT_OK);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      `Claude Code: 已写入 ${path.join(currentTempDir(), CLAUDE_RELATIVE_PATH)}`,
    );
    expect(result.stdout).toContain(
      `Cursor: 已写入 ${path.join(currentTempDir(), CURSOR_RELATIVE_PATH)}`,
    );
    expect(result.stdout).toContain(
      `VS Code: 已写入 ${path.join(currentTempDir(), VSCODE_RELATIVE_PATH)}`,
    );

    expect(JSON.parse(readRawConfigFile(CLAUDE_RELATIVE_PATH))).toEqual({
      mcpServers: { murmur: CANONICAL_MURMUR_ENTRY },
    });
    expect(JSON.parse(readRawConfigFile(CURSOR_RELATIVE_PATH))).toEqual({
      mcpServers: { murmur: CANONICAL_MURMUR_ENTRY },
    });
    expect(JSON.parse(readRawConfigFile(VSCODE_RELATIVE_PATH))).toEqual({
      servers: { murmur: CANONICAL_MURMUR_ENTRY },
    });
  });

  it("writes 2-space-indented JSON exactly like the repo config writer (no trailing newline)", () => {
    tempDir = makeTempDir();
    runInstall(["--client", "claude"]);

    expect(readRawConfigFile(CLAUDE_RELATIVE_PATH)).toBe(
      JSON.stringify(
        { mcpServers: { murmur: CANONICAL_MURMUR_ENTRY } },
        null,
        2,
      ),
    );
  });

  it("VS Code uses the top-level key `servers`, never `mcpServers`", () => {
    tempDir = makeTempDir();
    runInstall(["--client", "vscode"]);

    const parsed = JSON.parse(readRawConfigFile(VSCODE_RELATIVE_PATH));
    expect(parsed).toEqual({ servers: { murmur: CANONICAL_MURMUR_ENTRY } });
    expect(parsed).not.toHaveProperty("mcpServers");
  });

  it("--client filters the write scope: only the requested client's file appears", () => {
    tempDir = makeTempDir();
    const result = runInstall(["--client", "cursor"]);

    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain(
      `Cursor: 已写入 ${path.join(currentTempDir(), CURSOR_RELATIVE_PATH)}`,
    );
    expect(
      fs.existsSync(path.join(currentTempDir(), CURSOR_RELATIVE_PATH)),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(currentTempDir(), CLAUDE_RELATIVE_PATH)),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(currentTempDir(), VSCODE_RELATIVE_PATH)),
    ).toBe(false);
  });

  it('--command overrides the executable verbatim; args stay ["mcp"]', () => {
    tempDir = makeTempDir();
    const electronEntry = "/Applications/Murmur.app/Contents/MacOS/Electron";
    const result = runInstall([
      "--client",
      "claude",
      "--command",
      electronEntry,
    ]);

    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(readRawConfigFile(CLAUDE_RELATIVE_PATH))).toEqual({
      mcpServers: { murmur: { command: electronEntry, args: ["mcp"] } },
    });
  });
});

describe("mcp install: idempotent merge, never clobber", () => {
  it("a second identical run reports 无变化 for every client and leaves bytes untouched", () => {
    tempDir = makeTempDir();
    const first = runInstall();
    expect(first.code).toBe(EXIT_OK);

    const rawBefore = {
      claude: readRawConfigFile(CLAUDE_RELATIVE_PATH),
      cursor: readRawConfigFile(CURSOR_RELATIVE_PATH),
      vscode: readRawConfigFile(VSCODE_RELATIVE_PATH),
    };

    const second = runInstall();
    expect(second.code).toBe(EXIT_OK);
    expect(second.stderr).toBe("");
    expect(second.stdout).toContain(
      `Claude Code: 无变化 ${path.join(currentTempDir(), CLAUDE_RELATIVE_PATH)}`,
    );
    expect(second.stdout).toContain(
      `Cursor: 无变化 ${path.join(currentTempDir(), CURSOR_RELATIVE_PATH)}`,
    );
    expect(second.stdout).toContain(
      `VS Code: 无变化 ${path.join(currentTempDir(), VSCODE_RELATIVE_PATH)}`,
    );
    expect(readRawConfigFile(CLAUDE_RELATIVE_PATH)).toBe(rawBefore.claude);
    expect(readRawConfigFile(CURSOR_RELATIVE_PATH)).toBe(rawBefore.cursor);
    expect(readRawConfigFile(VSCODE_RELATIVE_PATH)).toBe(rawBefore.vscode);
  });

  it("merges into existing files preserving foreign server entries and unrelated top-level keys", () => {
    tempDir = makeTempDir();
    writeConfigFile(
      CLAUDE_RELATIVE_PATH,
      JSON.stringify({
        mcpServers: {
          "other-server": { command: "npx", args: ["-y", "other-mcp"] },
        },
        customTopLevel: { keep: true },
      }),
    );

    const result = runInstall(["--client", "claude"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain(
      `Claude Code: 已更新（合并） ${path.join(currentTempDir(), CLAUDE_RELATIVE_PATH)}`,
    );

    expect(JSON.parse(readRawConfigFile(CLAUDE_RELATIVE_PATH))).toEqual({
      mcpServers: {
        "other-server": { command: "npx", args: ["-y", "other-mcp"] },
        murmur: CANONICAL_MURMUR_ENTRY,
      },
      customTopLevel: { keep: true },
    });
  });

  it("creates the client's server map when the file exists without it (top-level keys preserved)", () => {
    tempDir = makeTempDir();
    writeConfigFile(VSCODE_RELATIVE_PATH, JSON.stringify({ otherTop: 42 }));

    const result = runInstall(["--client", "vscode"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("已更新（合并）");

    expect(JSON.parse(readRawConfigFile(VSCODE_RELATIVE_PATH))).toEqual({
      otherTop: 42,
      servers: { murmur: CANONICAL_MURMUR_ENTRY },
    });
  });

  it("replaces an existing murmur entry with different args (foreign entries preserved)", () => {
    tempDir = makeTempDir();
    writeConfigFile(
      CURSOR_RELATIVE_PATH,
      JSON.stringify({
        mcpServers: {
          murmur: { command: "old-cli", args: ["mcp", "--legacy"] },
          other: { command: "keep-me" },
        },
      }),
    );

    const result = runInstall(["--client", "cursor"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("已更新（合并）");

    expect(JSON.parse(readRawConfigFile(CURSOR_RELATIVE_PATH))).toEqual({
      mcpServers: {
        murmur: CANONICAL_MURMUR_ENTRY,
        other: { command: "keep-me" },
      },
    });
  });

  it("deep-merges inside the murmur entry only: unknown nested keys survive, command/args are canonical", () => {
    tempDir = makeTempDir();
    writeConfigFile(
      CLAUDE_RELATIVE_PATH,
      JSON.stringify({
        mcpServers: {
          murmur: { command: "old", args: ["mcp"], env: { MURMUR_TOKEN: "t" } },
        },
      }),
    );

    const result = runInstall(["--client", "claude"]);
    expect(result.code).toBe(EXIT_OK);

    expect(JSON.parse(readRawConfigFile(CLAUDE_RELATIVE_PATH))).toEqual({
      mcpServers: {
        murmur: {
          command: "murmur",
          args: ["mcp"],
          env: { MURMUR_TOKEN: "t" },
        },
      },
    });
  });

  it("an identical pre-existing murmur entry counts as 无变化 (no rewrite)", () => {
    tempDir = makeTempDir();
    const existing = JSON.stringify({
      mcpServers: { murmur: CANONICAL_MURMUR_ENTRY, other: { command: "x" } },
      note: "hand-written",
    });
    writeConfigFile(CLAUDE_RELATIVE_PATH, existing);

    const result = runInstall(["--client", "claude"]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("无变化");
    expect(result.stderr).toBe("");
    expect(readRawConfigFile(CLAUDE_RELATIVE_PATH)).toBe(existing);
  });
});

describe("mcp install: invalid existing config never gets overwritten", () => {
  it("single requested client with invalid JSON → exit 1, file content untouched", () => {
    tempDir = makeTempDir();
    const broken = "{ not valid json !!!";
    writeConfigFile(CURSOR_RELATIVE_PATH, broken);

    const result = runInstall(["--client", "cursor"]);
    expect(result.code).toBe(EXIT_RUNTIME_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("不是有效的 JSON");
    expect(result.stderr).toContain("已保留原文件未做修改");
    expect(readRawConfigFile(CURSOR_RELATIVE_PATH)).toBe(broken);
  });

  it("non-object top level → exit 1, untouched; non-object server map → exit 1, untouched", () => {
    tempDir = makeTempDir();
    writeConfigFile(CLAUDE_RELATIVE_PATH, JSON.stringify([1, 2, 3]));
    const arrayResult = runInstall(["--client", "claude"]);
    expect(arrayResult.code).toBe(EXIT_RUNTIME_ERROR);
    expect(readRawConfigFile(CLAUDE_RELATIVE_PATH)).toBe(
      JSON.stringify([1, 2, 3]),
    );

    writeConfigFile(CLAUDE_RELATIVE_PATH, JSON.stringify({ mcpServers: "no" }));
    const mapResult = runInstall(["--client", "claude"]);
    expect(mapResult.code).toBe(EXIT_RUNTIME_ERROR);
    expect(mapResult.stderr).toContain("mcpServers");
    expect(readRawConfigFile(CLAUDE_RELATIVE_PATH)).toBe(
      JSON.stringify({ mcpServers: "no" }),
    );
  });

  it("one invalid client among all → partial success exit 0; the healthy clients still install", () => {
    tempDir = makeTempDir();
    const broken = "~~not json~~";
    writeConfigFile(CLAUDE_RELATIVE_PATH, broken);

    const result = runInstall();
    expect(result.code).toBe(EXIT_OK);
    // Failure text on stderr only; successful per-client lines stay on stdout.
    expect(result.stderr).toContain("不是有效的 JSON");
    expect(result.stdout).toContain(
      `Cursor: 已写入 ${path.join(currentTempDir(), CURSOR_RELATIVE_PATH)}`,
    );
    expect(result.stdout).toContain(
      `VS Code: 已写入 ${path.join(currentTempDir(), VSCODE_RELATIVE_PATH)}`,
    );
    expect(result.stdout).not.toContain("Claude Code");
    expect(readRawConfigFile(CLAUDE_RELATIVE_PATH)).toBe(broken);
  });
});

describe("mcp install: usage errors (exit 2)", () => {
  it("unknown --client value is a usage error", () => {
    tempDir = makeTempDir();
    const result = runInstall(["--client", "fenster"]);
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("未知的客户端: fenster");
    expect(result.stderr).toContain("Usage:");
  });

  it("--user is rejected as 尚未支持 (usage 2) and writes nothing", () => {
    tempDir = makeTempDir();
    const result = runInstall(["--user"]);
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("尚未支持");
    expect(fs.readdirSync(currentTempDir())).toEqual([]);
  });

  it("extra positionals and unknown flags are usage errors", () => {
    tempDir = makeTempDir();
    const positional = runInstall(["now"]);
    expect(positional.code).toBe(EXIT_USAGE_ERROR);
    expect(positional.stderr).toContain("unexpected extra arguments");

    const unknownFlag = runInstall(["--force"]);
    expect(unknownFlag.code).toBe(EXIT_USAGE_ERROR);
    expect(unknownFlag.stderr).toContain("--force");
  });

  it("an empty --command value is a usage error", () => {
    tempDir = makeTempDir();
    const result = runInstall(["--client", "claude", "--command", "   "]);
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stderr).toContain("--command 不能为空");
  });

  it("--project (the documented default) is accepted explicitly", () => {
    tempDir = makeTempDir();
    const result = runInstall(["--client", "claude", "--project"]);
    expect(result.code).toBe(EXIT_OK);
    expect(
      fs.existsSync(path.join(currentTempDir(), CLAUDE_RELATIVE_PATH)),
    ).toBe(true);
  });
});

describe("mcp install: --json schema", () => {
  it("fresh install locks the per-client record schema and order", () => {
    tempDir = makeTempDir();
    const result = runInstall([], { json: true });

    expect(result.code).toBe(EXIT_OK);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      clients: [
        {
          client: "claude",
          label: "Claude Code",
          path: path.join(currentTempDir(), CLAUDE_RELATIVE_PATH),
          status: "created",
          success: true,
          error: null,
        },
        {
          client: "cursor",
          label: "Cursor",
          path: path.join(currentTempDir(), CURSOR_RELATIVE_PATH),
          status: "created",
          success: true,
          error: null,
        },
        {
          client: "vscode",
          label: "VS Code",
          path: path.join(currentTempDir(), VSCODE_RELATIVE_PATH),
          status: "created",
          success: true,
          error: null,
        },
      ],
    });
  });

  it('a second run reports status "unchanged" per client', () => {
    tempDir = makeTempDir();
    runInstall();
    const second = runInstall([], { json: true });

    const parsed = JSON.parse(second.stdout) as {
      clients: { client: string; status: string }[];
    };
    expect(
      parsed.clients.map((record) => [record.client, record.status]),
    ).toEqual([
      ["claude", "unchanged"],
      ["cursor", "unchanged"],
      ["vscode", "unchanged"],
    ]);
  });

  it('a failed client carries status "failed", success false and the error text', () => {
    tempDir = makeTempDir();
    writeConfigFile(CLAUDE_RELATIVE_PATH, "~~broken~~");

    const result = runInstall(["--client", "claude"], { json: true });
    expect(result.code).toBe(EXIT_RUNTIME_ERROR);
    const parsed = JSON.parse(result.stdout) as {
      clients: {
        client: string;
        status: string;
        success: boolean;
        error: string | null;
      }[];
    };
    expect(parsed.clients).toHaveLength(1);
    expect(parsed.clients[0]?.client).toBe("claude");
    expect(parsed.clients[0]?.status).toBe("failed");
    expect(parsed.clients[0]?.success).toBe(false);
    expect(parsed.clients[0]?.error).toContain("不是有效的 JSON");
  });
});

describe("mcp install: routing and help", () => {
  it("bare `murmur mcp` still rejects positionals — only the exact `mcp install` prefix is routed", async () => {
    tempDir = makeTempDir();
    // bare `mcp` (#269) is an async bridge-family command → await the result.
    const result = await runCli(["mcp", "bogus"], {
      cwd: currentTempDir(),
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stderr).toContain("mcp: unexpected extra arguments");
    expect(
      fs.existsSync(path.join(currentTempDir(), CLAUDE_RELATIVE_PATH)),
    ).toBe(false);
  });

  it("--help documents `mcp install` with clients, scope and --command", () => {
    const result = runCli(["--help"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("mcp install");
    expect(result.stdout).toContain("--client");
    expect(result.stdout).toContain("--command");
    expect(result.stdout).toContain("servers");
  });
});
