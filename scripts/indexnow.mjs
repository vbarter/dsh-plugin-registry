#!/usr/bin/env node
/**
 * Submit the 10 P0 landing URLs to IndexNow (api.indexnow.org + bing.com).
 * Key file must be live at https://dsplugin.app/{key}.txt after deploy.
 * Do not invent Bing webmaster verification codes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "dsplugin.app";
const KEY = "9856f1bd954f9ff5f39d8b1c63eb3a0e";
const KEY_LOCATION = "https://dsplugin.app/" + KEY + ".txt";
const ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
];
const PATHS = [
  "/",
  "/install",
  "/publish",
  "/vs",
  "/plugins/modlens",
  "/plugins/dsh-web-ui",
  "/plugins/dsh-cc-tui",
  "/c/vision",
  "/c/web-ui",
  "/c/tui",
];

const keyFile = path.join(ROOT, KEY + ".txt");
const onDisk = fs.readFileSync(keyFile, "utf8").trim();
if (onDisk !== KEY) {
  console.error("IndexNow key file mismatch: " + keyFile);
  process.exit(1);
}

const body = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: KEY_LOCATION,
  urlList: PATHS.map(function (p) {
    return "https://" + HOST + p;
  }),
});

async function post(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: body,
  });
  const text = await res.text();
  console.log(url + " → " + res.status + (text ? " " + text.slice(0, 200) : ""));
  return res.ok || res.status === 202;
}

const results = [];
for (const url of ENDPOINTS) {
  try {
    results.push(await post(url));
  } catch (err) {
    console.error(url + " → " + err.message);
    results.push(false);
  }
}

if (!results.every(Boolean)) process.exit(1);
console.log("IndexNow submitted " + PATHS.length + " URLs");
