// [dev-startup-hardening P0.1 → P2.1] Runtime smoke for dev:main.
// P2.1: dev:main loads the SAME artifact as prod (esbuild bundles main.ts →
// dist-main/main.js, then `electron .` reads package.json main). So this smoke
// now spawns `electron .` and asserts [main:canary] (main.ts:12, preserved by
// esbuild) fires. Catches any regression where the main entry never loads
// (wrong main field, broken build, app-path resolution). The canary fires
// before DatabaseManager.initialize, so this is independent of the
// better-sqlite3 ABI state (dev-135 vs test-137).
import { describe, it } from "vitest";
import { spawn, execSync, type ChildProcess } from "child_process";
import { createRequire } from "module";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, "../..");
const CANARY = "[main:canary] main.ts module-load-started";
const BUNDLE = path.join(ROOT, "dist-main/main.js");
const TIMEOUT_MS = 20_000;

describe("dev:main runtime smoke (silent-hang guard)", () => {
  it(
    "electron . loads dist-main/main.js — canary fires (dev/prod same artifact)",
    () => {
      // Self-contained: ensure the bundle exists so `pnpm test` works standalone.
      if (!fs.existsSync(BUNDLE)) {
        execSync("npm run build:main", { cwd: ROOT, stdio: "ignore" });
      }
      return new Promise<void>((resolve, reject) => {
        const electronPath = require("electron") as string;
        let buf = "";
        let settled = false;
        const child: ChildProcess = spawn(
          electronPath,
          [".", "--dev"], // electron . reads package.json main → dist-main/main.js
          {
            cwd: ROOT,
            env: {
              ...process.env,
              NODE_ENV: "test", // headless: app.disableHardwareAcceleration
              ELECTRON_ENABLE_LOGGING: "1",
              CSC_IDENTITY_AUTO_DISCOVERY: "false",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
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
                  `dev:main smoke: canary missing after ${TIMEOUT_MS}ms — main entry never loaded.\ncaptured:\n${buf.slice(-800)}`,
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
                  `dev:main smoke: electron exited code=${code} before canary — main entry did not load.\ncaptured:\n${buf.slice(-800)}`,
                ),
              ),
            );
          }
        });
      });
    },
    TIMEOUT_MS + 5_000,
  );
});
