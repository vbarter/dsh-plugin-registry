#!/usr/bin/env node
/**
 * One-pass ${VAR} substitution from the environment.
 * Replacement text is not scanned again, so values that contain
 * backticks, $(...), or quotes are written literally.
 *
 * Usage: node scripts/render-template.mjs <template> <dest> KEY [KEY...]
 */
import { readFile, writeFile } from "node:fs/promises";

const [tplPath, dest, ...keys] = process.argv.slice(2);
if (!tplPath || !dest || keys.length === 0) {
  console.error("usage: render-template.mjs <template> <dest> KEY [KEY...]");
  process.exit(1);
}

const allow = new Set(keys);
const tpl = await readFile(tplPath, "utf8");
const rendered = tpl.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) => {
  if (!allow.has(key)) return match;
  return process.env[key] ?? "";
});
await writeFile(dest, rendered);
