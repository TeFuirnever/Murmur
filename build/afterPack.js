// [20260912_Feat_272DistCli] electron-builder afterPack hook (ticket #272).
// The macOS DMG must carry cli/shims/murmur.sh with the executable bit or
// the Homebrew `binary` symlink cannot exec it. electron-builder's file
// pipeline does not guarantee POSIX permission preservation, so restore the
// bit deterministically after the app is packed, before signing/DMG.
// Idempotent and layout-tolerant: chmods every *.sh under the packaged
// cli/shims directory when it exists (mac: Contents/Resources, win:
// resources\ — harmless there; .cmd files need no exec bit).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// rwxr-xr-x: owner can execute/edit, others can execute/read.
const POSIX_EXECUTABLE_MODE = 0o755;

module.exports = async function afterPack(context) {
  // getResourcesDir is Contents/Resources on macOS and <root>\resources on
  // Windows/Linux — exactly where extraResources places the cli tree.
  const shimsDir = path.join(
    context.packager.getResourcesDir(context.appOutDir),
    "cli",
    "shims",
  );
  if (!fs.existsSync(shimsDir)) {
    // Loud, not silent: a missing shims dir means the DMG would ship a
    // non-executable murmur.sh and the CLI would be dead on arrival.
    throw new Error(
      `afterPack: cli shims dir missing from the package: ${shimsDir}`,
    );
  }
  for (const entry of fs.readdirSync(shimsDir)) {
    if (entry.endsWith(".sh")) {
      fs.chmodSync(path.join(shimsDir, entry), POSIX_EXECUTABLE_MODE);
    }
  }
  // Version overlay for resolveCliVersion (walks up from cli/): copy the
  // root package.json into the packaged cli dir. Done HERE, not via
  // extraResources — an extraResources entry sourced from the root
  // package.json makes the files matcher drop package.json from app.asar
  // and electron-builder validation fails ("package.json was not found").
  const cliDir = path.dirname(shimsDir);
  fs.copyFileSync(
    path.join(context.packager.projectDir, "package.json"),
    path.join(cliDir, "package.json"),
  );
};
