#!/bin/sh
# [20260912_Feat_272DistCli] POSIX launcher shim for the packaged `murmur`
# CLI (ticket #272). Ships inside the app bundle at
# Contents/Resources/cli/shims/ and runs the CLI through the bundled
# Electron binary in ELECTRON_RUN_AS_NODE mode, so `murmur` works on a
# machine with no system Node.js installed. The Homebrew cask symlinks this
# file onto PATH as `murmur`.
#
# Packaged layout (macOS .app bundle):
#   Murmur.app/Contents/MacOS/Murmur                 <- Electron runtime binary
#   Murmur.app/Contents/Resources/cli/shims/murmur.sh <- this file
#   Murmur.app/Contents/Resources/cli/murmur.mjs      <- CLI entry
# electron-builder renames the runtime binary to the productName
# ("Murmur", verified in .github/workflows/build.yml packaged-app smoke);
# "Electron" is kept as a fallback in case that rename ever changes.

# Resolve symlinks so invocation through a PATH symlink (Homebrew `binary`
# stanza) still finds the app bundle: $0 alone points at the symlink, not
# at this file inside the bundle.
target=$0
while [ -L "$target" ]; do
  link=$(readlink "$target")
  case $link in
    /*) target=$link ;;
    *) target=$(dirname -- "$target")/$link ;;
  esac
done
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$target")" && pwd)

# From Contents/Resources/cli/shims the runtime is three levels up.
RUNTIME="$SCRIPT_DIR/../../../MacOS/Murmur"
if [ ! -x "$RUNTIME" ]; then
  RUNTIME="$SCRIPT_DIR/../../../MacOS/Electron"
fi
if [ ! -x "$RUNTIME" ]; then
  echo "murmur: Electron runtime not found inside the Murmur app bundle" >&2
  echo "murmur: expected $SCRIPT_DIR/../../../MacOS/Murmur (or Electron)" >&2
  exit 1
fi

# ELECTRON_RUN_AS_NODE makes the Electron binary behave as a plain Node
# runtime instead of booting the GUI app.
export ELECTRON_RUN_AS_NODE=1
exec "$RUNTIME" "$SCRIPT_DIR/../murmur.mjs" "$@"
