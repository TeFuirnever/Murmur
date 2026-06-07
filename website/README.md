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
- `src/components/` — Astro components (Header, Hero, FeatureGrid, etc.)
- `src/i18n/` — UI strings (en.json, zh.json)
- `src/styles/global.css` — Tailwind v4 + custom CSS
- `public/` — Static assets (favicon, robots.txt)

## Deploy

Automatic via GitHub Actions on push to `main` with changes in `website/`.
Deploys to `gh-pages` branch → GitHub Pages.

## Tech Stack

| Layer     | Technology              |
| --------- | ----------------------- |
| Framework | Astro 5                 |
| UI        | React 19 (islands only) |
| Styling   | Tailwind CSS v4         |
| Icons     | Inline SVG              |
| Deploy    | GitHub Pages            |
