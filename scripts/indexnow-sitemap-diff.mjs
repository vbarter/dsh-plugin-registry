#!/usr/bin/env node
/**
 * Diff the live sitemap against .cache/sitemap-last.json and IndexNow only
 * added or lastmod-changed URLs (api.indexnow.org + bing.com).
 * First run / --init seeds the snapshot and does not push.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_PATH = path.join(ROOT, ".cache", "sitemap-last.json");
const HOST = "dsplugin.app";
const DEFAULT_KEY = "9856f1bd954f9ff5f39d8b1c63eb3a0e";
const DEFAULT_SITEMAP = "https://dsplugin.app/sitemap.xml";
const ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
];

const args = new Set(process.argv.slice(2));
const init = args.has("--init");
const dryRun = args.has("--dry-run");
const SITEMAP_URL = process.env.SITEMAP_URL || DEFAULT_SITEMAP;
const KEY = process.env.INDEXNOW_KEY || DEFAULT_KEY;
const KEY_LOCATION = "https://" + HOST + "/" + KEY + ".txt";

if (!process.env.INDEXNOW_KEY) {
  const keyFile = path.join(ROOT, KEY + ".txt");
  const onDisk = fs.readFileSync(keyFile, "utf8").trim();
  if (onDisk !== KEY) {
    console.error("IndexNow key file mismatch: " + keyFile);
    process.exit(1);
  }
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function tagText(block, name) {
  const re = new RegExp(
    "<(?:[\\w.-]+:)?" + name + "[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</(?:[\\w.-]+:)?" + name + ">",
    "i"
  );
  const match = block.match(re);
  if (!match) return "";
  return decodeXml((match[1] || match[2] || "").trim());
}

function parseSitemap(xml) {
  const urls = {};
  const blocks = xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi);
  for (const block of blocks) {
    const loc = tagText(block[1], "loc");
    if (!loc) continue;
    urls[loc] = tagText(block[1], "lastmod");
  }
  return urls;
}

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  if (!raw || typeof raw !== "object" || !raw.urls || typeof raw.urls !== "object") {
    throw new Error("Invalid snapshot: " + SNAPSHOT_PATH);
  }
  return raw;
}

function writeSnapshot(urls) {
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  const snapshot = {
    fetchedAt: new Date().toISOString(),
    urls: urls,
  };
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
  console.log("snapshot written " + SNAPSHOT_PATH + " (" + Object.keys(urls).length + " URLs)");
}

function diffUrls(prev, next) {
  const added = [];
  const changed = [];
  const removed = [];
  for (const loc of Object.keys(next)) {
    if (!(loc in prev)) {
      added.push(loc);
    } else if (String(prev[loc] || "") !== String(next[loc] || "")) {
      changed.push(loc);
    }
  }
  for (const loc of Object.keys(prev)) {
    if (!(loc in next)) removed.push(loc);
  }
  added.sort();
  changed.sort();
  removed.sort();
  return { added, changed, removed };
}

function logDiff(diff, prev, next) {
  console.log("added (" + diff.added.length + ")" + (diff.added.length ? ":" : ""));
  for (const loc of diff.added) console.log("  + " + loc);
  console.log("changed (" + diff.changed.length + ")" + (diff.changed.length ? ":" : ""));
  for (const loc of diff.changed) {
    console.log("  ~ " + loc + " (" + (prev[loc] || "") + " → " + (next[loc] || "") + ")");
  }
  console.log("removed (" + diff.removed.length + ")" + (diff.removed.length ? ":" : ""));
  for (const loc of diff.removed) console.log("  - " + loc + " (log only, no IndexNow delete)");
}

async function postIndexNow(url, urlList) {
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urlList,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: body,
  });
  const text = await res.text();
  console.log(url + " → " + res.status + (text ? " " + text.slice(0, 200) : ""));
  return res.status === 200 || res.status === 202;
}

const sitemapRes = await fetch(SITEMAP_URL, {
  headers: { accept: "application/xml, text/xml, */*" },
});
if (!sitemapRes.ok) {
  console.error("Failed to fetch sitemap " + SITEMAP_URL + " → " + sitemapRes.status);
  process.exit(1);
}
const xml = await sitemapRes.text();
const urls = parseSitemap(xml);
const count = Object.keys(urls).length;
if (!count) {
  console.error("Sitemap contained no <loc> entries: " + SITEMAP_URL);
  process.exit(1);
}
console.log("sitemap: " + count + " URLs from " + SITEMAP_URL);

let snapshot;
try {
  snapshot = readSnapshot();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (init || !snapshot) {
  const reason = init ? "--init" : "missing snapshot";
  console.log(reason + ": seeding " + count + " URLs, skip IndexNow");
  if (dryRun) {
    console.log("--dry-run: no snapshot write");
    process.exit(0);
  }
  writeSnapshot(urls);
  process.exit(0);
}

const prev = snapshot.urls;
const diff = diffUrls(prev, urls);
logDiff(diff, prev, urls);

const toPush = diff.added.concat(diff.changed);
if (!toPush.length) {
  console.log("no added or lastmod-changed URLs");
  if (dryRun) {
    console.log("--dry-run: no snapshot write");
    process.exit(0);
  }
  writeSnapshot(urls);
  process.exit(0);
}

console.log("IndexNow candidates (" + toPush.length + "): " + toPush.join(" "));
if (dryRun) {
  console.log("--dry-run: no push, no snapshot write");
  process.exit(0);
}

const results = [];
for (const url of ENDPOINTS) {
  try {
    results.push(await postIndexNow(url, toPush));
  } catch (err) {
    console.error(url + " → " + err.message);
    results.push(false);
  }
}

if (!results.every(Boolean)) {
  console.error("IndexNow push failed; snapshot left unchanged for retry");
  process.exit(1);
}

writeSnapshot(urls);
console.log("IndexNow submitted " + toPush.length + " URLs");
