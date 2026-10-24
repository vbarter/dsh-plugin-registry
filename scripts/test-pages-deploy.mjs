// Pages upload: full catalog stays out of the asset dir, lite shards stay
// under 25 MiB, and the browser loader can put the shards back together.
//   node scripts/test-pages-deploy.mjs
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { onRequest as redirectCatalog } from "../functions/data/plugins.json/index.js";
import {
  PAGES_FILE_LIMIT,
  SHARD_TARGET,
  packPlugins,
  preparePagesDeploy,
  shardText,
} from "./prepare-pages-deploy.mjs";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
let failed = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`ok  ${message}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${message}`);
}

function assertBytes(bytes, message) {
  assert(bytes < PAGES_FILE_LIMIT, `${message} (${bytes} < ${PAGES_FILE_LIMIT})`);
}

const tiny = Array.from({ length: 40 }, (_, i) => ({
  id: `p${i}`,
  description: "x".repeat(80),
}));
const groups = packPlugins(tiny, 700);
assert(groups.length >= 2, "tiny catalog splits into at least 2 shards");
const flat = groups.flat();
assert(flat.length === tiny.length, "pack keeps every plugin");
assert(JSON.stringify(flat) === JSON.stringify(tiny), "pack keeps plugin order and fields");
for (const group of groups) {
  const bytes = Buffer.byteLength(shardText(group));
  assertBytes(bytes, "tiny shard under Pages limit");
  if (group.length > 1) assert(bytes <= 700, `multi-plugin shard stays within target (${bytes})`);
}

const redirect = redirectCatalog();
assert(redirect.status === 302, "full catalog route is 302");
const location = redirect.headers.get("location") || "";
assert(
  location === "https://raw.githubusercontent.com/vbarter/dsh-plugin-registry/main/data/plugins.json",
  "302 target is GitHub raw on main"
);
assert(redirect.headers.get("access-control-allow-origin") === "*", "302 allows CORS");

const opsHtml = await readFile(join(ROOT, "plugins/dsh-ops.html"), "utf8");
assert(opsHtml.includes("<title>dsh-ops｜DeepSeek Harness 插件</title>"), "dsh-ops title unchanged");
assert(
  opsHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-ops">'),
  "dsh-ops canonical unchanged"
);
assert(
  opsHtml.includes('<h1 class="page-title">dsh-ops｜DeepSeek Harness 插件</h1>'),
  "dsh-ops h1 unchanged"
);

const outDir = await mkdtemp(join(tmpdir(), "pages-out-"));
const wholeDir = await mkdtemp(join(tmpdir(), "pages-whole-"));
try {
  const prepared = await preparePagesDeploy({ root: ROOT, outDir });
  assert(prepared.shardInfo.sharded === true, "current lite catalog is sharded");
  assert(prepared.shardInfo.shards.length >= 2, "at least two lite shards");
  let missingFull = false;
  try {
    await stat(join(outDir, "data/plugins.json"));
  } catch {
    missingFull = true;
  }
  assert(missingFull, "upload omits data/plugins.json");
  const sourceFull = await stat(join(ROOT, "data/plugins.json"));
  assert(sourceFull.size >= PAGES_FILE_LIMIT, "git copy of plugins.json is still over the limit");

  const envelope = JSON.parse(await readFile(join(outDir, "data/plugins-lite.json"), "utf8"));
  assert(!Array.isArray(envelope.plugins), "sharded envelope has no plugins array");
  assert(envelope.shards.length === prepared.shardInfo.shards.length, "envelope lists every shard");
  assert(envelope.stats && envelope.stats.published > 0, "envelope keeps stats");
  const rebuilt = [];
  for (const name of envelope.shards) {
    const path = join(outDir, "data", name);
    const info = await stat(path);
    assertBytes(info.size, name);
    assert(info.size <= SHARD_TARGET, `${name} is within the 12 MiB shard target (${info.size})`);
    const body = JSON.parse(await readFile(path, "utf8"));
    rebuilt.push(...body.plugins);
  }
  const envBytes = (await stat(join(outDir, "data/plugins-lite.json"))).size;
  assertBytes(envBytes, "envelope");
  assert(rebuilt.length === prepared.shardInfo.count, "shard plugin count matches");
  const ops = rebuilt.find((p) => p.id === "T-Auto/dsh-ops");
  assert(ops && ops.name === "dsh-ops", "sharded lite still contains T-Auto/dsh-ops");
  assert(prepared.largest.bytes < PAGES_FILE_LIMIT, "largest upload file is under 25 MiB");
  const landingStat = await stat(join(outDir, "plugins/dsh-ops.html"));
  assert(landingStat.isFile(), "dsh-ops landing is in the upload");
  const landing = await readFile(join(outDir, "plugins/dsh-ops.html"), "utf8");
  assert(landing.includes('href="https://dsplugin.app/plugins/dsh-ops"'), "uploaded landing keeps canonical");

  const whole = await preparePagesDeploy({
    root: ROOT,
    outDir: wholeDir,
    shardTarget: PAGES_FILE_LIMIT - 1,
  });
  assert(whole.shardInfo.sharded === false, "lite under the override target stays one file");
  const wholeLite = JSON.parse(await readFile(join(wholeDir, "data/plugins-lite.json"), "utf8"));
  assert(Array.isArray(wholeLite.plugins) && wholeLite.plugins.length === rebuilt.length, "unsharded lite keeps plugins");
  let wholeLeak = false;
  try {
    await stat(join(wholeDir, "data/plugins.json"));
    wholeLeak = true;
  } catch {
    wholeLeak = false;
  }
  assert(!wholeLeak, "unsharded upload still omits plugins.json");
  assertBytes(whole.largest.bytes, "unsharded largest file");
} finally {
  await rm(outDir, { recursive: true, force: true });
  await rm(wholeDir, { recursive: true, force: true });
}

const dataCode = await readFile(join(ROOT, "js/data.js"), "utf8");
const factsCode = await readFile(join(ROOT, "js/plugin-facts.js"), "utf8");

function browserContext(files) {
  const counts = {};
  const sandbox = {
    console,
    URLSearchParams,
    decodeURIComponent,
    location: { search: "", pathname: "/", hash: "" },
    history: { replaceState() {} },
    fetch(url) {
      counts[url] = (counts[url] || 0) + 1;
      const body = files[url];
      if (!body) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json() {
            return Promise.reject(new Error("no body"));
          },
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json() {
          return Promise.resolve(body);
        },
      });
    },
  };
  sandbox.window = {};
  sandbox.document = {
    querySelector(sel) {
      if (sel === "[data-plugin-facts]") return sandbox.root;
      return null;
    },
  };
  sandbox.root = {
    facts: {},
    getAttribute(name) {
      return name === "data-plugin-id" ? "T-Auto/dsh-ops" : null;
    },
    querySelector(sel) {
      return {
        set textContent(value) {
          sandbox.root.facts[sel] = value;
        },
      };
    },
  };
  vm.createContext(sandbox);
  return { sandbox, counts };
}

async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const catalogFiles = {
  "/data/plugins-lite.json": {
    stats: { published: 2 },
    categories: { tools: { zh: "工具", en: "Tools" } },
    shards: ["plugins-lite-000.json", "plugins-lite-001.json"],
  },
  "/data/plugins-lite-000.json": {
    plugins: [{ id: "T-Auto/dsh-ops", name: "dsh-ops", stars: 4006, pushedAt: "2026-10-01T00:00:00.000Z", verification: { manifest: "shape_validated" } }],
  },
  "/data/plugins-lite-001.json": {
    plugins: [{ id: "other/one", name: "one", stars: 3 }],
  },
  "/data/plugins.json": {
    plugins: [{ id: "T-Auto/dsh-ops", name: "dsh-ops", description: { zh: "全文", en: "full" } }],
  },
};

const liteBrowser = browserContext(catalogFiles);
vm.runInContext(dataCode, liteBrowser.sandbox);
const lite = await liteBrowser.sandbox.window.DSH.loadCatalog();
assert(lite.plugins.length === 2, "loader joins lite shards");
assert(lite.plugins[0].id === "T-Auto/dsh-ops", "loader keeps shard order");
assert(lite.stats.published === 2, "loader keeps envelope stats");
const again = await liteBrowser.sandbox.window.DSH.loadCatalog();
assert(again === lite, "second lite load uses the cache");
assert(liteBrowser.counts["/data/plugins-lite.json"] === 1, "envelope is fetched once");
assert(liteBrowser.counts["/data/plugins-lite-000.json"] === 1, "shard 0 is fetched once");

const fullBrowser = browserContext(catalogFiles);
vm.runInContext(dataCode, fullBrowser.sandbox);
const full = await fullBrowser.sandbox.window.DSH.loadCatalog({ full: true });
assert(full.plugins[0].description.zh === "全文", "detail load uses the full catalog");
assert(!fullBrowser.counts["/data/plugins-lite.json"], "full hit does not fetch lite");

const fallbackFiles = { ...catalogFiles };
delete fallbackFiles["/data/plugins.json"];
const fallbackBrowser = browserContext(fallbackFiles);
vm.runInContext(dataCode, fallbackBrowser.sandbox);
const fallback = await fallbackBrowser.sandbox.window.DSH.loadCatalog({ full: true });
assert(fallback.plugins.length === 2, "detail falls back to lite shards when full catalog 404s");
assert(fallback.plugins[1].id === "other/one", "fallback keeps the second shard");

const factsBrowser = browserContext(catalogFiles);
vm.runInContext(factsCode, factsBrowser.sandbox);
await drain();
const facts = factsBrowser.sandbox.root.facts;
assert(facts["[data-fact='stars']"] === "4,006", "plugin-facts reads stars from lite shards");
assert(facts["[data-fact='manifest']"] === "格式检查通过", "plugin-facts reads manifest from lite shards");
assert(
  /^\d{4}-\d{2}-\d{2}$/.test(facts["[data-fact='updated']"] || ""),
  "plugin-facts reads pushedAt from lite shards"
);
assert(!factsBrowser.counts["/data/plugins.json"], "plugin-facts does not fetch the full catalog");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
