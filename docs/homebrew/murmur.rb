# Homebrew Cask formula for Murmur
# Install: brew install --cask murmur
# Submit to: https://github.com/Homebrew/homebrew-cask

cask "murmur" do
  version "1.0.0"
  sha256 "TBD" # Update with actual SHA256 of the DMG

  url "https://github.com/TeFuirnever/Murmur/releases/download/v#{version}/Murmur-#{version}-arm64.dmg"
  name "Murmur"
  desc "Open-source voice-to-text desktop app with local FunASR speech recognition"
  homepage "https://github.com/TeFuirnever/Murmur"

  depends_on macos: ">= :ventura"

  app "Murmur.app"

  zap trash: [
    "~/Library/Application Support/murmur",
    "~/Library/Caches/com.murmur.app",
    "~/Library/Preferences/com.murmur.app.plist",
  ]

  caveats <<~EOS
    Murmur requires ffmpeg for audio format conversion (mp3/m4a support).
    Install it with: brew install ffmpeg

    On first launch, Murmur downloads the FunASR speech recognition model (~1GB).
  EOS
end
