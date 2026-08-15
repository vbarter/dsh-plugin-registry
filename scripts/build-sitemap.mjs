#!/usr/bin/env node
/**
 * Build sitemap.xml (index), sitemap-static.xml, and sitemap-plugins.xml
 * from data/plugins.json. Re-run after catalog updates.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://dsplugin.app";
const TODAY = "2026-08-16";

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isoDate(value) {
  if (!value) return "";
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return "";
  const ts = Date.parse(s.length === 10 ? s + "T00:00:00Z" : s);
  if (Number.isNaN(ts)) return "";
  return s.slice(0, 10);
}

function urlEntry(loc, lastmod, changefreq) {
  let out = "  <url>\n    <loc>" + xmlEscape(loc) + "</loc>\n";
  if (lastmod) out += "    <lastmod>" + lastmod + "</lastmod>\n";
  if (changefreq) out += "    <changefreq>" + changefreq + "</changefreq>\n";
  return out + "  </url>\n";
}

const staticPages = [
  SITE + "/",
  SITE + "/publish.html",
  SITE + "/dashboard.html",
  SITE + "/policy.html",
  SITE + "/llms.txt",
];

const staticXml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  staticPages.map(function (loc) {
    return urlEntry(loc, TODAY, "weekly");
  }).join("") +
  "</urlset>\n";

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "plugins.json"), "utf8"));
const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];

let pluginXml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

let withLastmod = 0;
for (const plugin of plugins) {
  if (!plugin || !plugin.id) continue;
  const loc = SITE + "/plugin-detail.html?plugin=" + encodeURIComponent(plugin.id);
  const lastmod = isoDate(plugin.pushedAt) || isoDate(plugin.addedAt);
  if (lastmod) withLastmod += 1;
  pluginXml += urlEntry(loc, lastmod, "");
}
pluginXml += "</urlset>\n";

const indexXml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  "  <sitemap>\n" +
  "    <loc>" + SITE + "/sitemap-static.xml</loc>\n" +
  "    <lastmod>" + TODAY + "</lastmod>\n" +
  "  </sitemap>\n" +
  "  <sitemap>\n" +
  "    <loc>" + SITE + "/sitemap-plugins.xml</loc>\n" +
  "    <lastmod>" + TODAY + "</lastmod>\n" +
  "  </sitemap>\n" +
  "</sitemapindex>\n";

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), indexXml);
fs.writeFileSync(path.join(ROOT, "sitemap-static.xml"), staticXml);
fs.writeFileSync(path.join(ROOT, "sitemap-plugins.xml"), pluginXml);

console.log(
  "Wrote sitemap.xml (index), sitemap-static.xml (" +
    staticPages.length +
    " URLs), sitemap-plugins.xml (" +
    plugins.length +
    " URLs, " +
    withLastmod +
    " with lastmod)"
);
