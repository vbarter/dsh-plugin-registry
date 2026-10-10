#!/usr/bin/env node
/**
 * Write sitemap.xml as a single urlset of the indexable landing URLs.
 * Do not emit sitemap-static.xml or sitemap-plugins.xml.
 * Existing P0 lastmods stay 2026-08-16. New plugin locs use their ship date.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://dsplugin.app";
const LEGACY = "2026-08-16";
const PAGES = [
  ["/", LEGACY],
  ["/install", LEGACY],
  ["/publish", LEGACY],
  ["/vs", LEGACY],
  ["/plugins/modlens", LEGACY],
  ["/plugins/dsh-web-ui", LEGACY],
  ["/plugins/dsh-cc-tui", LEGACY],
  ["/c/vision", LEGACY],
  ["/c/web-ui", LEGACY],
  ["/c/tui", LEGACY],
  ["/plugins/dsh-boot-animation", "2026-10-10"],
  ["/plugins/dsh-tool-12306", "2026-10-10"],
];
function urlEntry(loc, lastmod) {
  return "  <url>\n    <loc>" + loc + "</loc>\n    <lastmod>" + lastmod + "</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>\n";
}
const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
  "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" +
  PAGES.map(function (p) { return urlEntry(SITE + p[0], p[1]); }).join("") +
  "</urlset>\n";
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml);
console.log("Wrote sitemap.xml (" + PAGES.length + " URLs)");
