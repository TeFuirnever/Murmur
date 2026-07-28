#!/usr/bin/env node
// [dev-startup-hardening P0.2] better-sqlite3 native ABI preflight.
// Turns the recurring "test passes after dev, fails after install, 玄学" crash
// into a 5-second message at the boundary. Runs under whatever node invoked it:
//   - pretest (system node)            → asserts the TEST abi (137)
//   - after predev's electron-rebuild  → asserts the DEV/electron abi (135),
//     run via `cross-env ELECTRON_RUN_AS_NODE=1 electron scripts/check-native-abi.js`
const isElectron = process.env.ELECTRON_RUN_AS_NODE === "1";
const which = isElectron ? "electron" : "system";
try {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:"); // forces the native .node to load
  db.close();
  console.log(`[abi] better-sqlite3 OK under ${which} node`);
  process.exit(0);
} catch (e) {
  const first = (e && e.message ? e.message : String(e)).split("\n")[0];
  console.error(
    `[abi] FAIL: better-sqlite3 native won't load under ${which} node.`,
  );
  console.error(`      ${first}`);
  console.error("      fix → test (system node): pnpm rebuild better-sqlite3");
  console.error(
    "      fix → dev  (electron):    pnpm exec electron-rebuild   (predev does this)",
  );
  process.exit(1);
}
