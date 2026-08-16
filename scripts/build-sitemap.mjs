#!/usr/bin/env node
/**
 * Write sitemap.xml as a single urlset of the 10 indexable landing URLs.
 * Do not emit sitemap-static.xml or sitemap-plugins.xml.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://dsplugin.app";
const TODAY = "2026-08-16";
const PAGES = ["/", "/install", "/publish", "/vs", "/plugins/modlens", "/plugins/dsh-web-ui", "/plugins/dsh-cc-tui", "/c/vision", "/c/web-ui", "/c/tui"];
function urlEntry(loc) {
  return "  <url>\n    <loc>" + loc + "</loc>\n    <lastmod>" + TODAY + "</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>\n";
}
const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
  "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" +
  PAGES.map(function (p) { return urlEntry(SITE + p); }).join("") +
  "</urlset>\n";
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), xml);
console.log("Wrote sitemap.xml (" + PAGES.length + " URLs)");
