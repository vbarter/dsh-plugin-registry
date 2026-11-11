// Daily /new eligibility, sort, copy, and generated HTML.
//   node scripts/test-new-plugins.mjs
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_SLUGS } from "../functions/_middleware.js";
import { NEW_PLUGIN_COPY } from "./new-plugins-copy.mjs";
import {
  HOLD_IDS,
  buildNewPluginContext,
  exclusionReason,
  groupEligibleNewPlugins,
  identityKey,
  landingHref,
  loadNewPluginContext,
  newPluginScore,
  oneSentence,
  renderNewPluginPage,
  writeNewPluginPages,
} from "./new-plugins.mjs";

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

assert(NEW_PLUGIN_COPY.zh.title === "今日新增插件 · dsplugin.app", "zh title locked");
assert(NEW_PLUGIN_COPY.zh.h1 === "今日新增插件", "zh H1 locked");
assert(
  NEW_PLUGIN_COPY.zh.intro(3) === "今日新增 3 款插件，按综合得分排序；点名称查看详情。",
  "zh intro locked"
);
assert(NEW_PLUGIN_COPY.zh.empty === "今日暂无符合规则的新增插件。", "zh empty locked");
assert(NEW_PLUGIN_COPY.en.title === "Plugins added today · dsplugin.app", "en title locked");
assert(NEW_PLUGIN_COPY.en.h1 === "Plugins added today", "en H1 locked");
assert(
  NEW_PLUGIN_COPY.en.intro(3) === "3 plugins added today, sorted by a combined score. Open a name for details.",
  "en intro locked"
);
assert(NEW_PLUGIN_COPY.en.empty === "No matching plugins were added today.", "en empty locked");

assert(newPluginScore({ stars: 3, forks: 5 }) === 3 * 2 + 5 * 0.2, "score is stars*2 + forks*0.2");
assert(
  newPluginScore({ stars: 1, forks: 0 }) > newPluginScore({ stars: 0, forks: 5 }),
  "forks are weighted 0.2, not 1"
);

assert(identityKey("@cnhenaihui/dsh-ios-theme") === "dsh-ios-theme", "name last segment");
assert(identityKey("ys118/harnmem#packages/dsh-harnmem") === "dsh-harnmem", "id subpath last segment");
assert(oneSentence({ description: { zh: "第一句。第二句。", en: "English." } }) === "第一句。", "zh sentence wins");
assert(oneSentence({ description: { zh: "", en: "First. Second." } }) === "First.", "en fallback is one sentence");
assert(oneSentence({ description: { en: "Use 0.1.0 today. Next." } }) === "Use 0.1.0 today.", "version dots stay");
assert(
  oneSentence({
    description: { zh: "Per-project icons for the sidebar, with bundled SVG icons. / 给侧栏每个项目设定图标。" },
  }) === "Per-project icons for the sidebar, with bundled SVG icons.",
  "bilingual slash join keeps the first sentence"
);

const slugs = new Set(["dsh-ios", "modlens"]);
const base = (extra) => ({
  addedAt: "2026-11-11",
  install: "dsh plugin add",
  verification: { manifest: "shape_validated" },
  stars: 0,
  forks: 0,
  description: { zh: "一句话。" },
  topics: [],
  ...extra,
});
const fixtures = [
  base({ id: "ZSeven-W/dsh-ios", name: "@zseven-w/dsh-ios", stars: 1, description: { zh: "模拟器。" } }),
  base({ id: "cnhenaihui/dsh-ios-theme", name: "@cnhenaihui/dsh-ios-theme", stars: 50 }),
  base({ id: "evil/dsh-ios", name: "dsh-ios", stars: 40 }),
  base({ id: "x/theme-dsh-ios", name: "theme-dsh-ios", stars: 30 }),
  base({ id: "AcuteSZW/dsh-rea-pro", name: "dsh-rea-pro", stars: 9 }),
  base({ id: "wgl2zj/dsh-websearch-zai-codingplan", name: "dsh-web-search-zhipu-mcp", stars: 8 }),
  base({ id: "ok/renamed-mcp", name: "search-mcp", stars: 7 }),
  base({ id: "ok/normal-plugin", name: "normal-dsh", stars: 6, topics: ["mcp", "dsh-plugin"] }),
  base({ id: "ok/pending", name: "pending", stars: 100, verification: { manifest: "not_validated" } }),
  base({ id: "ok/no-install", name: "no-install", stars: 90, install: "  " }),
  base({ id: "someone/brand-new", name: "brand-new", stars: 2, forks: 0, description: { en: "English only." } }),
  base({ id: "a/alpha", name: "Alpha", stars: 1, forks: 0, description: { zh: "A。" } }),
  base({ id: "a/zebra", name: "Zebra", stars: 1, forks: 0, description: { zh: "Z。" } }),
  base({ id: "a/forks", name: "Forks", stars: 0, forks: 5, description: { zh: "F。" } }),
  base({ id: "a/low", name: "Low", stars: 1, forks: 0, description: { zh: "L。" } }),
  base({ id: "hold/example", name: "hold-me", stars: 80 }),
  base({ id: "other/later", name: "Later", addedAt: "2026-11-12", stars: 3 }),
  base({ id: "bad/day", name: "Bad", addedAt: "2026-11-31", stars: 1000 }),
  base({ id: "plain/nodesc", name: "NoDesc", stars: 4, description: {} }),
];
const ctx = buildNewPluginContext(fixtures, slugs, new Map([["dsh-ios", "ZSeven-W/dsh-ios"]]));
assert(exclusionReason(fixtures.find((row) => row.id === "ok/pending"), ctx) === "not_validated", "not_validated excluded");
assert(exclusionReason(fixtures.find((row) => row.id === "ok/no-install"), ctx) === "missing_install", "missing install excluded");
assert(exclusionReason(fixtures.find((row) => row.id === "AcuteSZW/dsh-rea-pro"), ctx) === "mcp", "dsh-rea-pro excluded");
assert(
  exclusionReason(fixtures.find((row) => row.id === "wgl2zj/dsh-websearch-zai-codingplan"), ctx) === "mcp",
  "zhipu mcp excluded"
);
assert(exclusionReason(fixtures.find((row) => row.id === "ok/renamed-mcp"), ctx) === "mcp", "mcp token in the name excluded");
assert(exclusionReason(fixtures.find((row) => row.id === "ok/normal-plugin"), ctx) == null, "topic mcp alone stays");
assert(exclusionReason(fixtures.find((row) => row.id === "cnhenaihui/dsh-ios-theme"), ctx) === "collision", "dsh-ios-theme collides");
assert(exclusionReason(fixtures.find((row) => row.id === "evil/dsh-ios"), ctx) === "collision", "same slug, other id collides");
assert(exclusionReason(fixtures.find((row) => row.id === "x/theme-dsh-ios"), ctx) === "collision", "suffix lookalike collides");
assert(exclusionReason(fixtures.find((row) => row.id === "ZSeven-W/dsh-ios"), ctx) == null, "live landing's own id stays");
HOLD_IDS.add("hold/example");
assert(exclusionReason(fixtures.find((row) => row.id === "hold/example"), ctx) === "hold", "HOLD id excluded");
HOLD_IDS.delete("hold/example");

assert(landingHref(fixtures.find((row) => row.id === "ZSeven-W/dsh-ios"), ctx) === "/plugins/dsh-ios", "live slug links to /plugins/dsh-ios");
assert(
  landingHref(fixtures.find((row) => row.id === "someone/brand-new"), ctx) === "/plugin-detail?plugin=someone%2Fbrand-new",
  "unknown slug links to plugin-detail"
);
assert(
  landingHref(fixtures.find((row) => row.id === "cnhenaihui/dsh-ios-theme"), ctx) ===
    "/plugin-detail?plugin=cnhenaihui%2Fdsh-ios-theme",
  "lookalike does not invent /plugins/dsh-ios-theme"
);
assert(!landingHref({ id: "a/b#c", name: "hash" }, ctx).includes("/plugins/"), "hash id stays on plugin-detail");

const grouped = groupEligibleNewPlugins(fixtures, ctx);
assert(!grouped.dates.includes("2026-11-31"), "invalid calendar date is not a page");
assert(!grouped.byDate.get("2026-11-11").some((row) => row.id === "cnhenaihui/dsh-ios-theme"), "theme row dropped");
const names = grouped.byDate.get("2026-11-11").map((row) => row.name);
assert(names.indexOf("NoDesc") < names.indexOf("brand-new"), "higher stars rank first");
assert(names.indexOf("Alpha") < names.indexOf("Low"), "equal score breaks by name");
assert(names.indexOf("Alpha") < names.indexOf("Zebra"), "Alpha before Zebra on a tie");
assert(names.indexOf("Low") < names.indexOf("Forks"), "1 star outranks 5 forks at 0.2");
assert(names.includes("normal-dsh"), "topic-mcp plugin is listed");
assert(names.includes("@zseven-w/dsh-ios"), "canonical plugin is listed");
assert(!names.includes("dsh-ios"), "squatter name is not listed");

const hrefs = grouped.byDate.get("2026-11-11").map((row) => row.href);
assert(hrefs.includes("/plugins/dsh-ios"), "allowlisted slug is linked");
assert(!hrefs.some((href) => href.startsWith("/plugins/") && !slugs.has(href.slice("/plugins/".length))), "no invented /plugins url");
assert(hrefs.filter((href) => href.startsWith("/plugins/")).every((href) => slugs.has(href.slice("/plugins/".length))), "plugin links are allowlisted");

const dayHtml = renderNewPluginPage({ date: "2026-11-11", rows: grouped.byDate.get("2026-11-11"), kind: "date" });
const hubHtml = renderNewPluginPage({ date: "2026-11-11", rows: grouped.byDate.get("2026-11-11"), kind: "hub" });
assert(dayHtml.includes('name="robots" content="noindex"'), "date html noindex");
assert(hubHtml.includes('name="robots" content="noindex"'), "hub html noindex");
assert(dayHtml.includes('rel="canonical" href="https://dsplugin.app/new"'), "date canonical is /new");
assert(hubHtml.includes('rel="canonical" href="https://dsplugin.app/new"'), "hub canonical is /new");
assert(dayHtml.includes('property="og:url" content="https://dsplugin.app/new/2026-11-11"'), "date og:url is the permalink");
assert(hubHtml.includes('property="og:url" content="https://dsplugin.app/new"'), "hub og:url is /new");
assert(dayHtml.includes('<h1 id="new-plugins-title" class="page-title" data-zh="今日新增插件" data-en="Plugins added today">今日新增插件</h1>'), "H1 source is exactly 今日新增插件");
assert(!/<h1[^>]*>[^<]*\d{4}-\d{2}-\d{2}/.test(dayHtml), "date is not in the H1");
assert(dayHtml.includes('<p class="page-sub" data-new-date="2026-11-11">2026-11-11</p>'), "date is the subtitle");
assert(dayHtml.includes(`今日新增 ${grouped.byDate.get("2026-11-11").length} 款插件，按综合得分排序；点名称查看详情。`), "intro uses the locked sentence");
assert(!dayHtml.includes("插件目录") && !dayHtml.includes("按最近收录"), "intro avoids homepage keywords");
const intro = dayHtml.match(/<p class="page-clarify"[^>]*>[^<]*<\/p>/)[0];
assert(!intro.includes("官方"), "intro does not say 官方");
assert(!intro.includes("Alpha"), "intro does not name a plugin");
assert(dayHtml.includes("<a href=\"/plugins/dsh-ios\">@zseven-w/dsh-ios</a>：模拟器。"), "row is name link plus one sentence");
assert(dayHtml.includes("<a href=\"/plugin-detail?plugin=plain%2Fnodesc\">NoDesc</a></li>"), "missing description has no dangling colon");
assert(!dayHtml.includes("/plugins/dsh-ios-theme"), "page never links a lookalike slug");
assert(!dayHtml.includes("prow-stars") && !dayHtml.includes("prow-forks"), "page does not print rank columns");
assert(!dayHtml.includes(">50<") && !dayHtml.includes(">160<"), "page does not print score numbers");
const emptyHtml = renderNewPluginPage({ date: "2026-01-02", rows: [], kind: "date" });
assert(emptyHtml.includes("今日暂无符合规则的新增插件。"), "empty copy is available to the renderer");
assert(emptyHtml.includes("No matching plugins were added today."), "empty en copy is available");

const tmp = await mkdtemp(join(tmpdir(), "new-plugins-"));
try {
  const written = await writeNewPluginPages({
    outDir: tmp,
    plugins: fixtures,
    slugs,
    canonicalBySlug: new Map([["dsh-ios", "ZSeven-W/dsh-ios"]]),
  });
  assert(written.latest === "2026-11-12", "hub follows the latest eligible day");
  assert(existsSync(join(tmp, "new/2026-11-11.html")), "eligible date file is written");
  assert(existsSync(join(tmp, "new/2026-11-31.html")) === false, "invalid date file is not written");
  assert(existsSync(join(tmp, "new/index.html")), "hub file is written");
  const onlyExcluded = [
    base({ id: "z/none", name: "none", addedAt: "2026-04-01", verification: { manifest: "not_validated" } }),
  ];
  const none = await writeNewPluginPages({
    outDir: tmp,
    plugins: onlyExcluded,
    slugs,
    canonicalBySlug: new Map(),
  });
  assert(none.latest == null, "a day with zero eligible plugins does not become a hub");
  assert(existsSync(join(tmp, "new/2026-04-01.html")) === false, "zero-eligible day is not written");
  assert(existsSync(join(tmp, "new/index.html")) === false, "hub is removed when nothing is eligible");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const catalogTmp = await mkdtemp(join(tmpdir(), "new-plugins-catalog-"));
try {
  const catalog = JSON.parse(await readFile(join(ROOT, "data/plugins.json"), "utf8"));
  const live = await loadNewPluginContext({ plugins: catalog.plugins, pluginsDir: join(ROOT, "plugins") });
  assert(live.owners.get("dsh-ios") === "ZSeven-W/dsh-ios", "dsh-ios owner comes from the live landing");
  const real = groupEligibleNewPlugins(catalog.plugins, live);
  assert(real.dates.includes("2026-11-11"), "catalog has an eligible 2026-11-11");
  const rows = real.byDate.get("2026-11-11");
  const ids = new Set(rows.map((row) => row.id));
  assert(!ids.has("AcuteSZW/dsh-rea-pro"), "catalog day drops dsh-rea-pro");
  assert(!ids.has("wgl2zj/dsh-websearch-zai-codingplan"), "catalog day drops zhipu mcp");
  assert(!ids.has("cnhenaihui/dsh-ios-theme"), "catalog day drops dsh-ios-theme");
  assert(!ids.has("AIBanlv/AIBanlv-Bot"), "catalog day drops not_validated");
  assert(!ids.has("MisakaChino/dsh-wallpaper-glass"), "catalog day drops missing install");
  assert(ids.has("JiamingShi-JsPhys/web-forager"), "mcp topic on a normal plugin stays");
  assert(ids.has("haikuotianko/dsh-toolboxes"), "topic mcp without an mcp token stays");
  assert(ids.has("JiamingShi-JsPhys/chelate-shell"), "installable validated plugin stays");
  const chelate = rows.findIndex((row) => row.id === "JiamingShi-JsPhys/chelate-shell");
  const forager = rows.findIndex((row) => row.id === "JiamingShi-JsPhys/web-forager");
  assert(chelate !== -1 && forager !== -1 && chelate < forager, "10 stars outrank 4 stars");
  for (const row of rows) {
    if (row.href.startsWith("/plugins/")) {
      assert(PLUGIN_SLUGS.has(row.href.slice("/plugins/".length)), `${row.href} is an allowlisted landing`);
    } else {
      assert(row.href.startsWith("/plugin-detail?plugin="), `${row.id} links to plugin-detail`);
    }
    assert(!row.href.includes("/plugins/dsh-ios-theme"), "no invented theme landing");
  }
  const catalogWritten = await writeNewPluginPages({
    outDir: catalogTmp,
    plugins: catalog.plugins,
    pluginsDir: join(ROOT, "plugins"),
  });
  assert(catalogWritten.latest === real.latest, "written hub date matches the group");
  const page = await readFile(join(catalogTmp, "new/2026-11-11.html"), "utf8");
  const expected = renderNewPluginPage({ date: "2026-11-11", rows, kind: "date" });
  assert(page === expected, "written date page matches the renderer");
  const list = page.split('<ul class="new-plugins"')[1].split("</ul>")[0];
  const pageHrefs = [...list.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert(pageHrefs.join("\n") === rows.map((row) => row.href).join("\n"), "HTML order matches stars*2 + forks*0.2");
  const sitemap = await readFile(join(ROOT, "sitemap.xml"), "utf8");
  assert(!sitemap.includes("dsplugin.app/new"), "committed sitemap has no /new");
  const ios = await readFile(join(ROOT, "plugins/dsh-ios.html"), "utf8");
  assert(ios.includes("<title>dsh-ios</title>"), "dsh-ios title stays frozen");
  assert(ios.includes('href="https://dsplugin.app/plugins/dsh-ios"'), "dsh-ios canonical stays frozen");
  assert(ios.includes("dsh plugin --profile web add github:ZSeven-W/dsh-ios"), "dsh-ios install stays frozen");
} finally {
  await rm(catalogTmp, { recursive: true, force: true });
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
