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
  // getResourcesDirectory is Contents/Resources on macOS and <root>\resources
  // on Windows/Linux — exactly where extraFiles places the cli tree.
  const shimsDir = path.join(
    context.packager.getResourcesDirectory(context.appOutDir),
    "cli",
    "shims",
  );
  if (!fs.existsSync(shimsDir)) {
    return;
  }
  for (const entry of fs.readdirSync(shimsDir)) {
    if (entry.endsWith(".sh")) {
      fs.chmodSync(path.join(shimsDir, entry), POSIX_EXECUTABLE_MODE);
    }
  }
};
