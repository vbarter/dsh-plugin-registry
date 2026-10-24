#!/usr/bin/env node
/**
 * Build the Cloudflare Pages upload directory.
 *
 * data/plugins.json stays in git (discover / ingest / GitHub raw) but is not
 * uploaded: Pages rejects a single asset at or above 25 MiB, and the full
 * catalog is already over that. /data/plugins.json is served by
 * functions/data/plugins.json/index.js (302 to GitHub raw).
 *
 * plugins-lite.json is what the site actually browses. Once it passes
 * SHARD_TARGET (12 MiB), split it into data/plugins-lite-NNN.json shards so
 * later discover growth does not redeploy one file into the 25 MiB wall.
 * The envelope keeps categories/stats and lists shard filenames. js/data.js
 * and js/plugin-facts.js reassemble them.
 *
 *   node scripts/prepare-pages-deploy.mjs
 *
 * Env:
 *   PAGES_OUT_DIR       output directory (default .pages-out)
 *   PAGES_SHARD_BYTES   override shard target, used by tests
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
export const SHARD_TARGET = 12 * 1024 * 1024;

const SKIP_TOP = new Set([
  ".git",
  "node_modules",
  ".pages-out",
  ".wrangler",
  ".cache",
  // Pages Functions are read from the repo root, not from the asset directory.
  "functions",
]);

const SHARD_WRAPPER = Buffer.byteLength('{"plugins":[]}\n');

export function packPlugins(plugins, targetBytes, hardLimit = PAGES_FILE_LIMIT) {
  if (!Number.isFinite(targetBytes) || targetBytes < SHARD_WRAPPER + 2) {
    throw new Error("shard target is too small");
  }
  const shards = [];
  let current = [];
  let bytes = SHARD_WRAPPER;

  function flush() {
    if (!current.length) return;
    shards.push(current);
    current = [];
    bytes = SHARD_WRAPPER;
  }

  for (const plugin of plugins) {
    const piece = Buffer.byteLength(JSON.stringify(plugin));
    if (SHARD_WRAPPER + piece >= hardLimit) {
      const id = plugin && plugin.id ? plugin.id : "?";
      throw new Error(`plugin ${id} is ${SHARD_WRAPPER + piece} bytes, over the Pages file limit`);
    }
    const add = current.length ? piece + 1 : piece;
    if (current.length && bytes + add > targetBytes) flush();
    const addNow = current.length ? piece + 1 : piece;
    current.push(plugin);
    bytes += addNow;
  }
  flush();
  return shards;
}

export function shardText(plugins) {
  return JSON.stringify({ plugins }) + "\n";
}

export async function writeLiteShards(litePath, targetBytes, hardLimit = PAGES_FILE_LIMIT) {
  const liteStat = await stat(litePath);
  if (liteStat.size < hardLimit && liteStat.size <= targetBytes) {
    return { sharded: false, bytes: liteStat.size, files: [litePath] };
  }
  const lite = JSON.parse(await readFile(litePath, "utf8"));
  if (!Array.isArray(lite.plugins)) {
    throw new Error("plugins-lite.json has no plugins array to shard");
  }
  const groups = packPlugins(lite.plugins, targetBytes, hardLimit);
  const dir = dirname(litePath);
  const names = [];
  for (let i = 0; i < groups.length; i++) {
    const name = `plugins-lite-${String(i).padStart(3, "0")}.json`;
    const text = shardText(groups[i]);
    const bytes = Buffer.byteLength(text);
    if (bytes >= hardLimit) {
      throw new Error(`${name} is ${bytes} bytes, over the Pages file limit`);
    }
    if (groups[i].length > 1 && bytes > targetBytes) {
      throw new Error(`${name} is ${bytes} bytes, over the shard target ${targetBytes}`);
    }
    await writeFile(join(dir, name), text);
    names.push(name);
  }
  const envelope = { ...lite, shards: names };
  delete envelope.plugins;
  const envText = JSON.stringify(envelope) + "\n";
  if (Buffer.byteLength(envText) >= hardLimit) {
    throw new Error("plugins-lite.json envelope is over the Pages file limit");
  }
  await writeFile(litePath, envText);
  return {
    sharded: true,
    shards: names,
    count: lite.plugins.length,
    envelopeBytes: Buffer.byteLength(envText),
  };
}

async function copyDataDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name === "plugins.json" && ent.isFile()) continue;
    const from = join(src, ent.name);
    const to = join(dest, ent.name);
    if (ent.isDirectory()) await copyDataDir(from, to);
    else await cp(from, to);
  }
}

async function walkFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walkFiles(path)));
    else if (ent.isFile()) out.push(path);
  }
  return out;
}

export async function preparePagesDeploy({
  root = ROOT,
  outDir,
  shardTarget = SHARD_TARGET,
  hardLimit = PAGES_FILE_LIMIT,
} = {}) {
  if (!outDir) throw new Error("outDir is required");
  const rootAbs = resolve(root);
  const outAbs = resolve(outDir);
  if (outAbs === rootAbs || rootAbs.startsWith(outAbs + "/")) {
    throw new Error("refusing to write the upload directory over the repo root");
  }
  await rm(outAbs, { recursive: true, force: true });
  await mkdir(outAbs, { recursive: true });

  const entries = await readdir(rootAbs, { withFileTypes: true });
  for (const ent of entries) {
    if (SKIP_TOP.has(ent.name)) continue;
    const from = join(rootAbs, ent.name);
    if (from === outAbs || outAbs.startsWith(from + "/")) continue;
    if (ent.isDirectory() && ent.name === "data") {
      await copyDataDir(from, join(outAbs, "data"));
      continue;
    }
    await cp(from, join(outAbs, ent.name), { recursive: true });
  }

  const liteOut = join(outAbs, "data", "plugins-lite.json");
  const fullLeak = join(outAbs, "data", "plugins.json");
  let leaked = false;
  try {
    await stat(fullLeak);
    leaked = true;
  } catch {
    leaked = false;
  }
  if (leaked) throw new Error("data/plugins.json was copied into the Pages upload");

  const shardInfo = await writeLiteShards(liteOut, shardTarget, hardLimit);
  const files = await walkFiles(outAbs);
  let largest = { path: "", bytes: 0 };
  for (const path of files) {
    const info = await stat(path);
    if (info.size >= hardLimit) {
      throw new Error(`${path} is ${info.size} bytes, at or above the ${hardLimit} byte Pages limit`);
    }
    if (info.size > largest.bytes) largest = { path, bytes: info.size };
  }
  return { outDir: outAbs, shardInfo, fileCount: files.length, largest };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const outDir = process.env.PAGES_OUT_DIR || join(ROOT, ".pages-out");
  const shardTarget = process.env.PAGES_SHARD_BYTES
    ? Number(process.env.PAGES_SHARD_BYTES)
    : SHARD_TARGET;
  preparePagesDeploy({ outDir, shardTarget })
    .then((result) => {
      const shard = result.shardInfo;
      if (shard.sharded) {
        console.log(
          `sharded plugins-lite into ${shard.shards.length} files (${shard.count} plugins), envelope ${shard.envelopeBytes} bytes`
        );
      } else {
        console.log(`plugins-lite.json left whole (${shard.bytes} bytes)`);
      }
      console.log(
        `upload ${result.fileCount} files, largest ${result.largest.bytes} bytes ${result.largest.path}`
      );
      console.log("wrote", result.outDir);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
