// [20260803_Feature_WebsiteRedesign] Minimal static file server for e2e tests.
//
// Why this exists: astro.config.mjs sets `base: "/Murmur"` for the GitHub
// Pages deployment (project site under /Murmur). `astro preview` honors that
// base at serve time, so the homepage is served at "/Murmur/" while "/" returns
// 404. But the e2e tests call page.goto("/") and page.goto("/zh/") expecting
// the app root, and the built HTML references assets as "/Murmur/_astro/...".
//
// This server serves the dist/ directory with two conventions:
//   1. The Astro base prefix "/Murmur" is stripped if present, so
//      "/Murmur/_astro/x.css" resolves to dist/_astro/x.css.
//   2. After stripping (or if absent), the path maps directly under dist/,
//      so "/" serves dist/index.html (the homepage) and "/zh/" serves the
//      Chinese page.
//
// This makes goto("/") reach the homepage AND keeps the "/Murmur/..." asset
// references in the built HTML valid. Zero dependencies (Node http + fs).
// [20260803_Feature_WebsiteRedesign] END
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, normalize, join } from "node:path";

const ROOT = new URL("../dist/", import.meta.url);
const PORT = Number(process.env.PORT ?? 4321);
const HOST = process.env.HOST ?? "localhost";
const BASE_PREFIX = "/Murmur";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url ?? "/", `http://${HOST}`).pathname);
    // Strip the Astro base prefix so built asset references resolve.
    if (urlPath.startsWith(BASE_PREFIX)) urlPath = urlPath.slice(BASE_PREFIX.length) || "/";
    // Prevent path traversal; normalize and clamp to ROOT.
    let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    if (rel === "/" || rel === "") rel = "/index.html";
    // Directory request → try index.html inside it.
    const rootPath = new URL(ROOT).pathname;
    const abs = join(rootPath, rel);
    // [20260803_Feature_WebsiteRedesign] Belt-and-suspenders: even if
    // normalize()/join() semantics change across Node versions or platforms,
    // reject any resolved path that escapes ROOT. The leading regex above
    // already blocked tested payloads, but this final guard makes the
    // invariant explicit rather than incidental.
    const withSep = rootPath.endsWith("/") ? rootPath : rootPath + "/";
    if (abs !== rootPath && !abs.startsWith(withSep)) {
      throw new Error("path escapes root");
    }
    // [20260803_Feature_WebsiteRedesign] END
    let target = abs;
    try {
      const s = await stat(abs);
      if (s.isDirectory()) target = join(abs, "index.html");
    } catch {
      // fall through; readFile will 404
    }
    const data = await readFile(target);
    res.writeHead(200, { "Content-Type": MIME[extname(target)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA-style fallback to 404 page if it exists, else plain 404.
    try {
      const notFound = await readFile(join(new URL(ROOT).pathname, "404.html"));
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(notFound);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404: Not found");
    }
  }
});

server.listen(PORT, HOST, () => {
  // Log readiness so Playwright's webServer probe detects the port.
  console.log(`e2e-server ready on http://${HOST}:${PORT}`);
});
