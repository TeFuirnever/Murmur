// [20260913_Feat_150_OgImage] Generates the dark-mode OG image matching the
// 20260803 site redesign (ticket #150): deep-purple background, fox-accent
// orbs (lavender/amber/pink), gradient headline, glass provider pills.
// Deterministic: the SVG is rendered to PNG via sharp (astro's transitive
// image dependency, resolvable from website/node_modules).
//   node scripts/og-image.mjs   →  public/og-image.png (1200×630)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "og-image.png",
);

// Brand tokens mirrored from src/styles/global.css (single source there).
const BG = "#0f0a1f";
const LAVENDER = "#a78bfa";
const AMBER = "#fb923c";
const PINK = "#f472b6";
const FONT = "-apple-system, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif";

const pill = (label, dotColor, x) => `
  <g>
    <rect x="${x}" y="506" width="180" height="52" rx="26"
      fill="rgba(255,255,255,0.05)" stroke="rgba(196,181,253,0.3)" stroke-width="1"/>
    <circle cx="${x + 26}" cy="532" r="5" fill="${dotColor}"/>
    <text x="${x + 44}" y="539" font-family="${FONT}" font-size="20"
      fill="rgba(245,243,255,0.92)">${label}</text>
  </g>`;

const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="orbL" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${LAVENDER}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${LAVENDER}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="orbA" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${AMBER}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${AMBER}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="orbP" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${PINK}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${PINK}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="headline" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${LAVENDER}"/>
      <stop offset="50%" stop-color="${AMBER}"/>
      <stop offset="100%" stop-color="${PINK}"/>
    </linearGradient>
    <linearGradient id="subtle" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#f5f3ff"/>
      <stop offset="100%" stop-color="#c4b5fd"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="${BG}"/>
  <circle cx="180" cy="120" r="340" fill="url(#orbL)"/>
  <circle cx="1060" cy="90" r="300" fill="url(#orbA)"/>
  <circle cx="980" cy="560" r="280" fill="url(#orbP)"/>

  <text x="80" y="120" font-family="${FONT}" font-size="30" font-weight="700"
    fill="#f5f3ff" letter-spacing="1">Murmur</text>
  <text x="212" y="119" font-family="${FONT}" font-size="17"
    fill="rgba(245,243,255,0.55)">Open Source · Privacy First</text>

  <text x="80" y="300" font-family="${FONT}" font-size="76" font-weight="700"
    fill="url(#headline)" letter-spacing="-1">Open Source · Local</text>
  <text x="80" y="392" font-family="${FONT}" font-size="76" font-weight="700"
    fill="url(#subtle)" letter-spacing="-1">AI Voice Input</text>

  <text x="80" y="452" font-family="${FONT}" font-size="27"
    fill="rgba(245,243,255,0.82)">Speak to type, instantly. Powered by FunASR —</text>
  <text x="80" y="490" font-family="${FONT}" font-size="27"
    fill="rgba(245,243,255,0.82)">zero data upload.</text>

  ${pill("FunASR", LAVENDER, 80)}
  ${pill("AI Polish", AMBER, 285)}
  ${pill("Local-only", PINK, 490)}

  <text x="80" y="596" font-family="${FONT}" font-size="20"
    fill="rgba(245,243,255,0.5)">github.com/TeFuirnever/Murmur · Apache-2.0</text>
</svg>`;

await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(OUT);
console.log(`og-image written: ${OUT} (${WIDTH}x${HEIGHT})`);
