#!/usr/bin/env node
/**
 * Build data/plugins-lite.json from data/plugins.json for homepage list loads.
 * Keep envelope identical; strip heavy per-plugin fields / truncate descriptions.
 *
 *   node scripts/build-plugins-lite.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FULL_PATH = join(ROOT, "data", "plugins.json");
const LITE_PATH = join(ROOT, "data", "plugins-lite.json");
const DESC_MAX = 120;
const TOPICS_MAX = 6;

function truncDesc(d) {
  if (d == null) return undefined;
  if (typeof d === "string") {
    const s = d.trim();
    if (!s) return undefined;
    return s.length <= DESC_MAX ? s : s.slice(0, DESC_MAX - 1) + "…";
  }
  if (typeof d === "object") {
    const out = {};
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== "string") continue;
      const s = v.trim();
      if (!s) continue;
      out[k] = s.length <= DESC_MAX ? s : s.slice(0, DESC_MAX - 1) + "…";
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

function slimPlugin(p) {
  const ver = p && p.verification && typeof p.verification === "object" ? p.verification : {};
  const row = {
    id: p.id,
    name: p.name,
    owner: p.owner,
    url: p.url,
    category: p.category,
    stars: p.stars,
    forks: p.forks,
    language: p.language,
    pushedAt: p.pushedAt,
    addedAt: p.addedAt,
    source: p.source,
    trustLevel: p.trustLevel,
    install: p.install,
  };
  const desc = truncDesc(p.description);
  if (desc) row.description = desc;
  if (p.archived) row.archived = true;
  if (ver.manifest != null) row.verification = { manifest: ver.manifest };
  const topics = Array.isArray(p.topics) ? p.topics.filter(Boolean).slice(0, TOPICS_MAX) : [];
  if (topics.length) row.topics = topics;
  // omit icon: list falls back to letter avatar; keeps payload smaller
  for (const k of Object.keys(row)) {
    if (row[k] == null || row[k] === "") delete row[k];
  }
  return row;
}

export async function buildPluginsLite(catalog) {
  const data =
    catalog ||
    JSON.parse(await readFile(FULL_PATH, "utf8"));
  const lite = {
    schemaVersion: data.schemaVersion || 2,
    generatedAt: data.generatedAt,
    categories: data.categories,
    stats: data.stats,
    sources: data.sources,
    plugins: (data.plugins || []).map(slimPlugin),
  };
  const text = JSON.stringify(lite) + "\n";
  await writeFile(LITE_PATH, text, "utf8");
  return { path: LITE_PATH, bytes: Buffer.byteLength(text), count: lite.plugins.length };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  buildPluginsLite()
    .then((r) => {
      console.log("wrote", r.path, "plugins", r.count, "bytes", r.bytes);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
