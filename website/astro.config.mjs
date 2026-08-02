import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://tefuirnever.github.io",
  base: "/Murmur",
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // [Fix] Explicitly empty PostCSS config prevents Vite from walking up
    // to the repo root postcss.config.ts (which references @tailwindcss/postcss,
    // not installed in website/node_modules). Tailwind v4 is handled by the
    // Vite plugin above — PostCSS is not needed.
    css: {
      postcss: {},
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
