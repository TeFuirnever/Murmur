# Murmur Website

Product landing page for [Murmur](https://github.com/TeFuirnever/Murmur) — open source local AI voice input.

## Development

```bash
cd website
npm install
npm run dev
```

Open `http://localhost:4321/Murmur/`

## Build

```bash
npm run build
npm run preview
```

## Structure

- `src/pages/` — Route pages (`/` EN, `/zh/` CN)
- `src/components/` — Astro components (Header, Hero, StatsStrip, FeatureGrid, etc.)
- `src/i18n/` — UI strings (en.json, zh.json) — keys MUST stay synchronized (unit-tested)
- `src/styles/global.css` — Tailwind v4 `@theme` tokens + custom CSS
- `public/` — Static assets (favicon, og-image, robots.txt)
- `scripts/e2e-server.mjs` — local static server for e2e (strips `/Murmur` base; `astro preview` 404s `/`)
- `tests/unit/` — build/i18n/seo unit tests (vitest)
- `tests/e2e/` — navigation/responsive/a11y/i18n/components/visual-redesign (playwright)

## Design system (fox brand)

Defined in `src/styles/global.css`. Token NAMES are load-bearing — Tailwind v4 silently drops utilities for renamed `@theme` tokens, so only change VALUES, never names.

- Palette: deep purple-black `#0f0a1f` bg, lavender `#a78bfa` → amber `#fb923c` brand gradient, fox-pink `#f472b6` accent. Dark-mode-first with a full light-mode token override.
- Fox alpha variants (`--fox-lavender-12`, `--fox-amber-15`, …) live in `:root` (not `@theme`) so components reference them without hardcoding `rgba()` duplicates.
- No Google Fonts (unreliable in mainland China); Inter is progressive enhancement only, CJK falls back to PingFang SC / Noto Sans SC.
- Animations respect `prefers-reduced-motion` (e2e-asserted for `.orb`, `.waveform-bar`, `.typing-cursor`).

## Deploy

Automatic via GitHub Actions on push to `main` with changes in `website/`.
Deploys to `gh-pages` branch → GitHub Pages.

## Tech Stack

| Layer     | Technology                             |
| --------- | -------------------------------------- |
| Framework | Astro 5 (pure Astro, no React runtime) |
| Styling   | Tailwind CSS v4 (`@theme` tokens)      |
| Icons     | Inline SVG                             |
| Tests     | vitest (unit) + playwright (e2e)       |
| Deploy    | GitHub Pages (gh-pages branch)         |

> **Local e2e note:** `astro preview` honors the `/Murmur` base and 404s `/`, so
> `playwright.config.ts` runs `scripts/e2e-server.mjs` (a tiny static server that
> strips the base) instead. Tests use `goto("/")` and the e2e server makes that
> resolve to the homepage. Don't switch the webServer back to `astro preview`.
