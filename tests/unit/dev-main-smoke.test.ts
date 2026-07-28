// [dev-startup-hardening P0.1] Runtime smoke for dev:main — the silent-hang guard.
// A string-only check (ci-config.test.ts) and bundled E2E (dist-main/main.js)
// both miss the bug class where `electron main.ts` spawns alive but never
// loads main.ts (the c875321 regression that潜伏ed for days). This test
// spawns the REAL dev:main load path and asserts the [main:canary] line
// (main.ts:12) fires within a hard timeout — proving main.ts module-loaded.
//
// The canary fires BEFORE DatabaseManager.initialize, so this smoke is
// independent of the better-sqlite3 ABI state (dev-135 vs test-137).
import { describe, it } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, "../..");
const CANARY = "[main:canary] main.ts module-load-started";
const TIMEOUT_MS = 20_000;

describe("dev:main runtime smoke (silent-hang guard)", () => {
  it(
    "electron loads main.ts via NODE_OPTIONS='--import tsx' — canary fires",
    () =>
      new Promise<void>((resolve, reject) => {
        // require('electron') under system node → Electron.app binary path
        // (the same binary dev:main ultimately runs, via cli.js).
        const electronPath = require("electron") as string;
        let buf = "";
        let settled = false;

        const child: ChildProcess = spawn(electronPath, ["main.ts", "--dev"], {
          cwd: ROOT,
          env: {
            ...process.env,
            NODE_ENV: "test", // headless: app.disableHardwareAcceleration
            NODE_OPTIONS: "--import tsx", // THE thing under test
            ELECTRON_ENABLE_LOGGING: "1",
            CSC_IDENTITY_AUTO_DISCOVERY: "false",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

        // settled flag + unref'd timer = no clearTimeout needed, no let for timer.
        const settle = (outcome: () => void): void => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL"); // canary already proved load — stop before app boot
          outcome();
        };

        const onChunk = (chunk: Buffer): void => {
          buf += chunk.toString();
          if (buf.includes(CANARY)) settle(resolve);
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);

        const timer = setTimeout(
          () =>
            settle(() =>
              reject(
                new Error(
                  `dev:main smoke: canary missing after ${TIMEOUT_MS}ms — silent hang (main.ts never loaded).\ncaptured:\n${buf.slice(-800)}`,
                ),
              ),
            ),
          TIMEOUT_MS,
        );
        timer.unref?.(); // don't keep vitest alive after the test settles

        child.on("exit", (code: number | null) => {
          if (!buf.includes(CANARY)) {
            settle(() =>
              reject(
                new Error(
                  `dev:main smoke: electron exited code=${code} before canary — main.ts did not load.\ncaptured:\n${buf.slice(-800)}`,
                ),
              ),
            );
          }
        });
      }),
    TIMEOUT_MS + 5_000,
  );
});
