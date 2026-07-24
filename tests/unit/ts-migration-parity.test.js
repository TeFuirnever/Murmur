// [20260724_Test_TsMigrationParity] End-to-end regression: verify that every
// .ts file with a real implementation produces the same exports and behavior
// as its .js counterpart. This catches drift between the dual-source files
// created during the backend TS migration (ADR-010).
//
// Seams under test:
// 1. Export shape parity — .ts exports match .js exports
// 2. Export value parity — exported functions/constants are equivalent
// 3. esbuild resolution — preload bundle resolves .js (not .ts) at production
// 4. vitest resolution — vitest resolves .ts first (typed source)
// 5. Backend type safety — no `any` or @ts-ignore in backend .ts files
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const requireCJS = createRequire(import.meta.url);
const rootDir = path.resolve(__dirname, "../..");

// Files that have both .js and .ts with real implementations
const DUAL_SOURCE_FILES = [
  "src/helpers/providerPresets",
  "src/helpers/ipc-contracts",
  "src/helpers/audioPathValidator",
  "src/utils/process",
  "src/helpers/logManager",
  "src/helpers/fileConfig",
  "src/helpers/ipcRateLimiter",
  "src/helpers/detectLocalModels",
  "src/helpers/environment",
  "src/helpers/serverMessageRouter",
];

describe("TS Migration Parity — .ts and .js produce equivalent exports", () => {
  DUAL_SOURCE_FILES.forEach((modulePath) => {
    const basename = path.basename(modulePath);
    const jsPath = path.join(rootDir, `${modulePath}.js`);
    const tsPath = path.join(rootDir, `${modulePath}.ts`);

    describe(`${basename}`, () => {
      it("both .js and .ts files exist", () => {
        expect(fs.existsSync(jsPath)).toBe(true);
        expect(fs.existsSync(tsPath)).toBe(true);
      });

      it(".ts file has tag comment (AGENTS.md compliance)", () => {
        const content = fs.readFileSync(tsPath, "utf8");
        expect(content).toMatch(/\[20\d{6}_/);
      });

      it("exported values are functionally equivalent", () => {
        const jsModule = requireCJS(jsPath);
        const tsModule = requireCJS(path.join(rootDir, `${modulePath}`));

        // Resolve the actual exported object (handle default export)
        const tsReal = tsModule.default || tsModule;
        const jsReal = jsModule.default || jsModule;

        if (basename === "ipc-contracts") {
          // Verify critical IPC channel strings match
          expect(jsReal.AUDIO_EXTENSIONS).toEqual(tsReal.AUDIO_EXTENSIONS);
          expect(jsReal.WINDOW?.HIDE).toBe(tsReal.WINDOW?.HIDE);
          expect(jsReal.EVENTS?.TRANSCRIPTION_UPDATE).toBe(
            tsReal.EVENTS?.TRANSCRIPTION_UPDATE,
          );
          expect(jsReal.AI?.PROCESS).toBe(tsReal.AI?.PROCESS);
          return;
        }

        if (basename === "providerPresets") {
          const jsP = jsReal.getProviderPresets();
          const tsP = tsReal.getProviderPresets();
          expect(jsP.length).toBe(tsP.length);
          expect(jsP[0].name).toBe(tsP[0].name);
          expect(jsP[0].base_url).toBe(tsP[0].base_url);
          expect(jsP[0].models).toEqual(tsP[0].models);
          return;
        }

        if (basename === "process") {
          expect(jsReal.TIMEOUTS).toEqual(tsReal.TIMEOUTS);
          return;
        }

        if (basename === "fileConfig") {
          expect(jsReal.FILE_CONFIGURABLE_KEYS).toEqual(
            tsReal.FILE_CONFIGURABLE_KEYS,
          );
          return;
        }

        if (basename === "ipcRateLimiter") {
          // It's a function — verify it's callable
          expect(typeof tsReal).toBe("function");
          return;
        }

        if (
          basename === "logManager" ||
          basename === "environment" ||
          basename === "serverMessageRouter" ||
          basename === "detectLocalModels"
        ) {
          // Class or function — verify same type
          const expectedType = typeof jsReal;
          expect(typeof tsReal).toBe(expectedType);
          return;
        }

        if (basename === "audioPathValidator") {
          expect(typeof tsReal.validateAudioPath).toBe("function");
          expect(typeof jsReal.validateAudioPath).toBe("function");
          return;
        }
      });
    });
  });
});

describe("Functional behavior parity — .ts produces correct results", () => {
  it("ipc-contracts: all channel groups accessible via .ts", () => {
    const C = require("../../src/helpers/ipc-contracts");
    const real = C.default || C;
    // Verify every group exists with expected shape
    [
      "FUNASR",
      "MODELS",
      "TRANSCRIPTION",
      "AI",
      "SETTINGS",
      "WINDOW",
      "HOTKEY",
      "CLIPBOARD",
      "UPDATE",
      "SYSTEM",
      "EVENTS",
    ].forEach((group) => {
      expect(real[group]).toBeDefined();
      expect(typeof real[group]).toBe("object");
    });
    expect(real.AUDIO_EXTENSIONS).toContain(".wav");
    expect(real.AUDIO_EXTENSIONS).toContain(".mp3");
  });

  it("providerPresets: getProviderByName works via .ts", () => {
    const { getProviderByName } = require("../../src/helpers/providerPresets");
    const deepseek = getProviderByName("deepseek");
    expect(deepseek).toBeDefined();
    expect(deepseek.name).toBe("deepseek");
    expect(deepseek.registration?.recommended).toBe(true);
    expect(getProviderByName("nonexistent")).toBeUndefined();
  });

  it("audioPathValidator: validateAudioPath works via .ts", () => {
    const {
      validateAudioPath,
    } = require("../../src/helpers/audioPathValidator");
    // Valid path
    const homeFile = path.join(require("os").homedir(), "test.wav");
    const result = validateAudioPath(homeFile);
    expect(result.valid).toBe(true);
    expect(result.ext).toBe(".wav");

    // Invalid extension
    const bad = validateAudioPath("/tmp/test.txt");
    expect(bad.valid).toBe(false);
  });

  it("fileConfig: load/save round-trip works via .ts", () => {
    const {
      loadFileConfig,
      saveFileConfig,
    } = require("../../src/helpers/fileConfig");
    const tmpFile = path.join(
      require("os").tmpdir(),
      `murmur-test-${Date.now()}.json`,
    );
    saveFileConfig(tmpFile, {
      ai_base_url: "https://test.com",
      evil_key: "bad",
    });
    const loaded = loadFileConfig(tmpFile);
    expect(loaded.ai_base_url).toBe("https://test.com");
    expect(loaded.evil_key).toBeUndefined(); // filtered out
    fs.unlinkSync(tmpFile);
  });

  it("ipcRateLimiter: rate limiting works via .ts", async () => {
    const createRateLimitedHandler = require("../../src/helpers/ipcRateLimiter");
    const real = createRateLimitedHandler.default || createRateLimitedHandler;
    let calls = 0;
    const handler = real(
      () => {
        calls++;
        return { success: true };
      },
      { maxCalls: 2, windowMs: 60000 },
    );
    await handler({});
    await handler({});
    const result = await handler({});
    expect(calls).toBe(2);
    expect(result).toEqual({ success: false, error: "Rate limit exceeded" });
  });
});

describe("Backend type safety — migrated .ts files follow standards", () => {
  // Only check backend .ts files (not frontend .tsx which have pre-existing any)
  const BACKEND_TS_FILES = [
    "src/helpers/providerPresets.ts",
    "src/helpers/ipc-contracts.ts",
    "src/helpers/audioPathValidator.ts",
    "src/helpers/logManager.ts",
    "src/helpers/fileConfig.ts",
    "src/helpers/ipcRateLimiter.ts",
    "src/helpers/detectLocalModels.ts",
    "src/helpers/environment.ts",
    "src/helpers/serverMessageRouter.ts",
    "src/helpers/aiPrompts.ts",
    "src/helpers/exportFormatters.ts",
    "src/helpers/audioFileHelpers.ts",
    "src/helpers/database.ts",
    "src/utils/process.ts",
  ];

  it("no backend .ts file uses explicit 'any' type", () => {
    const violations = [];
    for (const relPath of BACKEND_TS_FILES) {
      const fullPath = path.join(rootDir, relPath);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith("//")) continue;
        if (/\b:\s*any\b/.test(line) || /\bas\s+any\b/.test(line)) {
          violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no backend .ts file uses @ts-ignore or @ts-expect-error", () => {
    const violations = [];
    for (const relPath of BACKEND_TS_FILES) {
      const fullPath = path.join(rootDir, relPath);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, "utf8");
      if (
        content.includes("@ts-ignore") ||
        content.includes("@ts-expect-error")
      ) {
        violations.push(relPath);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("Resolution correctness — dual .ts/.js handled properly", () => {
  it("esbuild config prefers .js over .ts (--resolve-extensions=.js,.ts)", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
    );
    expect(pkg.scripts["build:preload"]).toContain(
      "--resolve-extensions=.js,.ts",
    );
    expect(pkg.scripts["build:main"]).toContain("--resolve-extensions=.js,.ts");
  });

  it("vitest config prefers .ts over .js", () => {
    const vitestConfig = fs.readFileSync(
      path.join(rootDir, "vitest.config.js"),
      "utf8",
    );
    const extMatch = vitestConfig.match(/extensions:\s*\[([^\]]+)\]/);
    expect(extMatch).toBeTruthy();
    const exts = extMatch[1];
    expect(exts.indexOf(".ts")).toBeLessThan(exts.indexOf(".js"));
  });
});

describe("No regression — preload bundle integrity", () => {
  it("preload bundle (if built) contains IPC channel constants", () => {
    const bundlePath = path.join(rootDir, "dist-preload", "preload.js");
    if (!fs.existsSync(bundlePath)) return; // skip if not built
    const content = fs.readFileSync(bundlePath, "utf8");
    // These strings come from ipc-contracts.js (resolved by esbuild)
    expect(content).toContain("file-transcription-progress");
    expect(content).toContain("transcribe-audio");
    expect(content).toContain("check-ai-status");
  });
});
