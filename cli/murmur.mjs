#!/usr/bin/env node
// [20260912_Feat_CliSkeleton] murmur CLI entry point (ticket #264, spec #258).
// Distributed with the app and run through the Electron binary in
// ELECTRON_RUN_AS_NODE mode (no system Node dependency at runtime), while
// staying a zero-dependency plain-ESM script that also works under plain
// `node` for development and tests. All real behaviour lives in
// cli/lib/cliRunner.mjs — this file only wires argv in and streams/exit out.
//
// Production invocation shape (packaged app):
//   ELECTRON_RUN_AS_NODE=1 <electron> <app>/cli/murmur.mur.mjs ... (bin shim)
// i.e. process.versions.electron is set. Running the script with a bare
// electron binary WITHOUT ELECTRON_RUN_AS_NODE would boot the GUI app
// instead of the CLI — that mis-invocation is rejected below with a clear
// message rather than silently launching a window.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./lib/cliRunner.mjs";
import { resolveCliVersion } from "./lib/version.mjs";

const EXIT_RUNTIME_ERROR = 1;

/** True when the runtime is Electron's Node (ELECTRON_RUN_AS_NODE or a shell). */
function isElectronRuntime() {
  return process.versions.electron !== undefined;
}

function main() {
  if (isElectronRuntime() && !process.env.ELECTRON_RUN_AS_NODE) {
    process.stderr.write(
      "murmur: refusing to run inside the Electron GUI runtime. " +
        "Set ELECTRON_RUN_AS_NODE=1, or launch the Murmur app directly.\n",
    );
    process.exit(EXIT_RUNTIME_ERROR);
  }

  // fileURLToPath (not URL.pathname): pathname yields "/C:/..." on Windows.
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const version = resolveCliVersion(cliDir);
  const result = runCli(process.argv.slice(2), { version });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}

main();
