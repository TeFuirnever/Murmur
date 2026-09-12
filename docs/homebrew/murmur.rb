# Homebrew Cask formula for Murmur
# [20260803_InstallHonesty] STATUS: DRAFT — NOT YET PUBLISHED.
# This cask has not been submitted to Homebrew/homebrew-cask, so
# `brew install --cask murmur` currently FAILS. Before submitting:
#   1. Update `version` to the latest release tag.
#   2. Fill `sha256` with the real DMG checksum (see checksums-sha256.txt in the release).
# Submit to: https://github.com/Homebrew/homebrew-cask
#
# Manual acceptance steps for the CLI stanza (release owner, on a real
# machine — CI cannot verify a brew install; ticket #272):
#   1. Install the DMG built from a release that contains this cask's
#      packaging changes, then `brew install --cask ./murmur.rb`.
#   2. In a NEW shell (no system Node.js installed): `murmur --version`
#      prints the app version and `murmur --help` prints usage.
#   3. `brew uninstall --cask murmur` removes the symlink: `murmur` no
#      longer resolves.
#   4. Confirm the shipped murmur.sh kept its executable bit inside the
#      DMG (enforced by build/afterPack.js):
#      ls -l /opt/homebrew/Caskroom/murmur/*/Murmur.app/Contents/Resources/cli/shims/

cask "murmur" do
  version "1.0.0"
  sha256 "TBD" # Update with actual SHA256 of the DMG

  url "https://github.com/TeFuirnever/Murmur/releases/download/v#{version}/Murmur-#{version}-arm64.dmg"
  name "Murmur"
  desc "Open-source voice-to-text desktop app with local FunASR speech recognition"
  homepage "https://github.com/TeFuirnever/Murmur"

  depends_on macos: ">= :ventura"

  app "Murmur.app"

  # [20260912_Feat_272DistCli] Put the bundled `murmur` CLI on PATH. The
  # shim execs the packaged CLI (Resources/cli/murmur.mjs) through the
  # bundled Electron runtime in ELECTRON_RUN_AS_NODE mode, so the CLI works
  # right after install with no system Node.js. Requires the .sh to keep
  # its executable bit in the DMG (restored by build/afterPack.js).
  binary "#{appdir}/Murmur.app/Contents/Resources/cli/shims/murmur.sh",
         target: "murmur"

  zap trash: [
    "~/Library/Application Support/murmur",
    "~/Library/Caches/com.murmur.app",
    "~/Library/Preferences/com.murmur.app.plist",
  ]

  caveats <<~EOS
    Murmur requires ffmpeg for audio format conversion (mp3/m4a support).
    Install it with: brew install ffmpeg

    On first launch, Murmur downloads the FunASR speech recognition model (~1GB).

    The `murmur` CLI ships inside the app and is linked onto your PATH
    (`murmur --version` in a new shell). It runs on Electron's built-in
    Node, so no system Node.js is required.
  EOS
end
