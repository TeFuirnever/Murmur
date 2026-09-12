// [20260912_Feat_CliSkeleton] Convention tests for the murmur CLI runner
// (ticket #264, spec #258). The locked global conventions are exercised here
// at function level (no process spawn, no Electron shell):
//   - exit codes: 0 success / 1 runtime error / 2 usage error (4 reserved)
//   - results on stdout, logs/errors on stderr only
//   - --json anywhere in argv switches stdout to structured output
//   - no prompts, no spinners: every invocation returns a complete result
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runCli,
  EXIT_OK,
  EXIT_RUNTIME_ERROR,
  EXIT_USAGE_ERROR,
} from "../../cli/lib/cliRunner.mjs";
import {
  resolveConfigPath,
  resolveDatabasePath,
  resolveDataDirectory,
} from "../../cli/lib/paths.mjs";

describe("cli exit-code conventions", () => {
  it("defines the locked exit codes 0/1/2", () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_RUNTIME_ERROR).toBe(1);
    expect(EXIT_USAGE_ERROR).toBe(2);
  });

  it("no arguments is a usage error: exit 2, usage on stderr, stdout empty", () => {
    const result = runCli([], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage:");
  });

  it("unknown command is a usage error (exit 2)", () => {
    const result = runCli(["wat"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stderr).toContain("unknown command: wat");
  });

  it("unknown subcommands are usage errors (exit 2)", () => {
    const configResult = runCli(["config", "delete", "theme"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(configResult.code).toBe(EXIT_USAGE_ERROR);

    const historyResult = runCli(["history", "export"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(historyResult.code).toBe(EXIT_USAGE_ERROR);
  });

  it("unknown flags are usage errors (exit 2)", () => {
    const result = runCli(["history", "list", "--frobnicate"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(result.code).toBe(EXIT_USAGE_ERROR);
    expect(result.stderr).toContain("--frobnicate");
  });

  it("missing database is a runtime error: exit 1, message on stderr, stdout empty", () => {
    const result = runCli(["history", "list"], {
      dbPath: "/nonexistent-dir-murmur-cli/transcriptions.db",
      configPath: "/tmp/x.json",
    });
    expect(result.code).toBe(EXIT_RUNTIME_ERROR);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("history list");
  });
});

describe("cli output conventions", () => {
  it("--help prints usage on stdout with exit 0 and nothing on stderr", () => {
    const result = runCli(["--help"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).toBe("");
  });

  it("--version prints the injected version with exit 0", () => {
    const result = runCli(["--version"], { version: "9.9.9-test" });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toBe("9.9.9-test\n");
    expect(result.stderr).toBe("");
  });

  it("--version without a resolvable version falls back to 'unknown'", () => {
    const result = runCli(["--version"]);
    expect(result.stdout).toBe("unknown\n");
  });

  it("--json is honoured as a global flag before the subcommand", () => {
    const result = runCli(["--json", "config", "get", "theme"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout)).toEqual({ key: "theme", value: null });
  });

  it("--json is honoured after the subcommand too", () => {
    const before = runCli(["config", "--json", "get", "theme"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    const after = runCli(["config", "get", "theme", "--json"], {
      configPath: "/tmp/x.json",
      dbPath: "/tmp/x.db",
    });
    expect(before.code).toBe(EXIT_OK);
    expect(after.code).toBe(EXIT_OK);
    expect(JSON.parse(before.stdout)).toEqual({ key: "theme", value: null });
    expect(JSON.parse(after.stdout)).toEqual({ key: "theme", value: null });
  });

  it("successful invocations never write to stderr (no logs on stdout path)", () => {
    const result = runCli(["config", "get", "theme"], {
      configPath: "/tmp/nonexistent-murmur.json",
      dbPath: "/tmp/x.db",
    });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("null\n");
  });

  it("runs synchronously and returns a complete result (no-TTY: no prompts, no spinners)", () => {
    // Function-level contract: an invocation neither reads stdin nor streams
    // progress — it resolves to the full { code, stdout, stderr } payload.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-cli-test-"));
    try {
      const result = runCli(["config", "set", "theme", "dark"], {
        configPath: path.join(dir, "murmur.json"),
        dbPath: "/tmp/x.db",
      });
      expect(result).toHaveProperty("code");
      expect(result).toHaveProperty("stdout");
      expect(result).toHaveProperty("stderr");
      expect(result.code).toBe(EXIT_OK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cli path resolution (mirrors environment.ts + main.ts + database.ts)", () => {
  const fakeHomedir = () => "/home/tester";

  it("ELECTRON_USER_DATA overrides the platform data directory", () => {
    const dir = resolveDataDirectory({
      env: { ELECTRON_USER_DATA: "/custom/user/data" },
      platform: "darwin",
      homedir: fakeHomedir,
    });
    expect(dir).toBe("/custom/user/data");
  });

  it("derives the platform data directory like environment.ts", () => {
    expect(
      resolveDataDirectory({
        env: {},
        platform: "darwin",
        homedir: fakeHomedir,
      }),
    ).toBe("/home/tester/Library/Application Support/Murmur");
    expect(
      resolveDataDirectory({
        env: {},
        platform: "win32",
        homedir: fakeHomedir,
      }),
    ).toBe(path.join("/home/tester", "AppData", "Roaming", "Murmur"));
    expect(
      resolveDataDirectory({
        env: {},
        platform: "linux",
        homedir: fakeHomedir,
      }),
    ).toBe("/home/tester/.config/Murmur");
  });

  it("resolves murmur.json next to the data directory (main.ts behaviour)", () => {
    const configPath = resolveConfigPath({
      env: { ELECTRON_USER_DATA: "/data" },
      platform: "darwin",
      homedir: fakeHomedir,
    });
    expect(configPath).toBe(path.join("/data", "murmur.json"));
  });

  it("resolves the database with the MURMUR_DB_PATH override (database.ts behaviour)", () => {
    const overridden = resolveDatabasePath({
      env: { MURMUR_DB_PATH: "/tmp/other.db", ELECTRON_USER_DATA: "/data" },
      platform: "darwin",
      homedir: fakeHomedir,
    });
    expect(overridden).toBe("/tmp/other.db");

    const defaulted = resolveDatabasePath({
      env: { ELECTRON_USER_DATA: "/data" },
      platform: "darwin",
      homedir: fakeHomedir,
    });
    expect(defaulted).toBe(path.join("/data", "transcriptions.db"));
  });
});
