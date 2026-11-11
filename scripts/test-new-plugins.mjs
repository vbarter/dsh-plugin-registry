// Daily /new eligibility, sort, copy, and generated HTML.
//   node scripts/test-new-plugins.mjs
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_SLUGS } from "../functions/_middleware.js";
import {
  NEW_PLUGIN_BLURBS,
  parseBlurbSheet,
  loadBlurbSheets,
  resolveWriterBlurb,
} from "./new-plugin-blurbs.mjs";
import { NEW_PLUGIN_COPY } from "./new-plugins-copy.mjs";
import {
  EN_BLURB_MAX,
  HOLD_IDS,
  ZH_BLURB_MAX,
  buildNewPluginContext,
  exclusionReason,
  groupEligibleNewPlugins,
  identityKey,
  landingHref,
  listBlurbs,
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
assert(listBlurbs({ description: { en: "Use 0.1.0 today. Next." } }).en === "Use today.", "semver noise is stripped");
assert(
  !listBlurbs({ description: { en: "Use 0.1.0 today. Next." } }).en.startsWith("Use 0."),
  "version dots are not sentence breaks"
);
assert(listBlurbs({ description: { en: "Ships v1.2 today. Next." } }).en === "Ships v1.2 today.", "two-part versions stay");

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
assert(
  dayHtml.includes(
    '<a href="/plugins/dsh-ios">@zseven-w/dsh-ios</a><span data-new-blurb data-zh="：模拟器。" data-en="：模拟器。">：模拟器。</span>'
  ),
  "row is name link plus one sentence"
);
assert(dayHtml.includes('data-en="：English only."'), "english page gets its own blurb attribute");
assert(dayHtml.includes('document.querySelectorAll("[data-new-blurb]")'), "locale toggle swaps list blurbs");
assert(dayHtml.includes("<a href=\"/plugin-detail?plugin=plain%2Fnodesc\">NoDesc</a></li>"), "missing description has no dangling colon");
assert(!dayHtml.includes("/plugins/dsh-ios-theme"), "page never links a lookalike slug");
assert(!dayHtml.includes("prow-stars") && !dayHtml.includes("prow-forks"), "page does not print rank columns");
assert(!dayHtml.includes(">50<") && !dayHtml.includes(">160<"), "page does not print score numbers");
const emptyHtml = renderNewPluginPage({ date: "2026-01-02", rows: [], kind: "date" });
assert(emptyHtml.includes("今日暂无符合规则的新增插件。"), "empty copy is available to the renderer");
assert(emptyHtml.includes("No matching plugins were added today."), "empty en copy is available");

const slashZh =
  "给侧栏每个项目设定图标，后面这半句是超长目录说明不应该整段留在中文列表里还要继续写到超过四十个字。";
const slash = listBlurbs({
  id: "ex/slash",
  addedAt: "2026-01-04",
  description: {
    zh: `Per-project icons for the sidebar, with bundled SVG icons. / ${slashZh}`,
    en: `Per-project icons for the sidebar, with bundled SVG icons. / ${slashZh}`,
  },
});
assert(
  slash.zh === "给侧栏每个项目设定图标，后面这半句是超长目录说明不应该整段留在中文列表里还要继续",
  "chinese page keeps the chinese half, capped near 40"
);
assert(slash.zh.length <= ZH_BLURB_MAX, "chinese fallback blurb stays within 40 characters");
assert(!slash.zh.includes("Per-project"), "chinese page does not keep the english catalog half");
assert(!slash.zh.includes("写到超过"), "long chinese catalog tail is cut");
assert(
  slash.en === "Per-project icons for the sidebar, with bundled SVG icons.",
  "english page keeps the english half's first sentence"
);
assert(!slash.en.includes("给侧栏"), "english page does not keep the chinese half");

const swapped = listBlurbs({
  id: "ex/swap",
  addedAt: "2026-01-05",
  description: {
    zh: "Long English catalog blurb that keeps going past one sentence. Second stays out.",
    en: "中文简介写在 en 字段。第二句不要。",
  },
});
assert(swapped.zh === "中文简介写在 en 字段。", "chinese page prefers chinese copy even when it is not description.zh");
assert(
  swapped.en === "Long English catalog blurb that keeps going past one sentence.",
  "english page still uses the english description"
);
assert(!swapped.zh.includes("catalog blurb"), "chinese page drops the long english blurb");

const introBlurb = listBlurbs({
  id: "ex/intro",
  addedAt: "2026-01-05",
  description: {
    zh: "A very long English catalog blurb that should not be the Chinese line. It has a second sentence too.",
    en: "A very long English catalog blurb that should not be the Chinese line. It has a second sentence too.",
  },
  intro: { zh: "中文简介在 intro 字段。第二句不要。" },
});
assert(introBlurb.zh === "中文简介在 intro 字段。", "chinese page prefers a chinese intro field");
assert(
  introBlurb.en === "A very long English catalog blurb that should not be the Chinese line.",
  "english page stays on the english description"
);

const tools = listBlurbs({
  id: "ex/tools",
  addedAt: "2026-01-05",
  description: { zh: "让 AI 调用 ffmpeg / ripgrep / fd，并在管理页看控制台。" },
});
assert(tools.zh.includes("ripgrep") && tools.zh.includes("ffmpeg"), "tool-list slashes are not a bilingual split");

const noisy = listBlurbs({
  id: "ex/noisy",
  addedAt: "2026-01-06",
  description: {
    en: "UI/UX Pro Max upstream main@4f2dbb67 (2026-11-08; skill.json reports 2.15.0, newer than the released 2.15.0) skill body that keeps going well past the tight English limit with extra catalog clauses about data and scripts. Second sentence stays out.",
  },
});
assert(
  noisy.en === "UI/UX Pro Max upstream skill body that keeps going well past the tight English",
  "commit hashes, versions, and the long tail are stripped"
);
assert(!noisy.en.includes("4f2dbb67") && !noisy.en.includes("2.15.0"), "hash and semver are gone");
assert(!noisy.en.includes("Second sentence"), "only the first sentence remains");
assert(noisy.en.length <= EN_BLURB_MAX, "english fallback stays within 80 characters");
assert(noisy.zh === noisy.en, "chinese page uses the tight english line when no chinese intro exists");

const longEn =
  "This is the first sentence of a catalog blurb that goes on and on and on past the tight english limit so the list cannot show the whole thing. Second sentence stays out.";
const long = listBlurbs({ id: "x/y", addedAt: "2026-01-02", description: { zh: longEn, en: longEn } });
assert(
  long.en === "This is the first sentence of a catalog blurb that goes on and on and on past",
  "a long first sentence is clipped tight"
);
assert(!long.en.includes("Second sentence") && !long.zh.includes("cannot show"), "leftover catalog sentence is gone");

const clipped = listBlurbs({
  id: "ex/clip",
  addedAt: "2026-01-07",
  description: {
    zh: "压缩上下文并保留要求和进度，支持回查和失败重试，TAILMARK这里是不应该留下的超长目录尾巴用于测试截断。",
  },
});
assert(clipped.zh === "压缩上下文并保留要求和进度，支持回查和失败重试", "chinese blurb stops near 40 characters");
assert(!clipped.zh.includes("TAILMARK"), "chinese blurb drops the long tail");

assert(
  listBlurbs({
    id: "JiamingShi-JsPhys/chelate-shell",
    addedAt: "2026-11-11",
    description: { en: "Totally different catalog text that is long. Second." },
  }).zh === "把本地技能编排成可按步骤执行的工作流",
  "dated writer override replaces the catalog blurb"
);
assert(
  listBlurbs({
    id: "JiamingShi-JsPhys/chelate-shell",
    addedAt: "2026-11-11",
    description: { en: "Totally different catalog text that is long. Second." },
  }).en === "Orchestrate local skills into step-by-step workflows",
  "dated writer override supplies the english line"
);
assert(
  listBlurbs({
    id: "JiamingShi-JsPhys/chelate-shell",
    addedAt: "2026-11-12",
    description: { en: "Totally different catalog text that is long. Second." },
  }).en === "Totally different catalog text that is long.",
  "a writer sheet does not leak onto another day"
);

NEW_PLUGIN_BLURBS["ex/custom"] = { zh: "自定义一行", en: "Custom one line" };
try {
  const custom = listBlurbs({
    id: "ex/custom",
    addedAt: "2026-02-02",
    description: { en: "Catalog sentence that must not win. Second." },
  });
  assert(custom.zh === "自定义一行" && custom.en === "Custom one line", "undated plugin-id override wins");
} finally {
  delete NEW_PLUGIN_BLURBS["ex/custom"];
}
assert(
  resolveWriterBlurb("ex/custom", "2026-02-02", {
    byDate: { "2026-02-02": { "ex/custom": { zh: "日期优先", en: "Date wins" } } },
    byId: { "ex/custom": { zh: "仅 id", en: "Id only" } },
  }).zh === "日期优先",
  "a dated sheet wins over the plugin-id map"
);

const escaped = renderNewPluginPage({
  date: "2026-01-09",
  kind: "date",
  rows: [
    {
      id: "a/b",
      name: "Name",
      zh: `Tom & Jerry's "quote"`,
      en: "Safe",
      href: "/plugin-detail?plugin=a%2Fb",
      score: 0,
    },
  ],
});
assert(escaped.includes("Tom &amp; Jerry&#39;s &quot;quote&quot;"), "blurb html is escaped");
assert(escaped.includes('data-en="：Safe"'), "english blurb attribute is separate");
assert(escaped.includes("<title>今日新增插件 · dsplugin.app</title>"), "blurb rows do not change the title");
assert(escaped.includes('rel="canonical" href="https://dsplugin.app/new"'), "blurb rows do not change canonical");
assert(escaped.includes('name="robots" content="noindex"'), "blurb rows do not change noindex");

const sheetTmp = await mkdtemp(join(tmpdir(), "new-blurbs-"));
try {
  await writeFile(
    join(sheetTmp, "2026-03-03.md"),
    "| plugin | 名称 | zh | en |\n|---|---|---|---|\n| owner/repo | NOT-THE-NAME | 掉进来的中文 | Dropped-in English |\n"
  );
  await writeFile(join(sheetTmp, "notes.md"), "| plugin | 名称 | zh | en |\n| other/repo | x | 不要读 | No |\n");
  const dropped = loadBlurbSheets(sheetTmp);
  assert(dropped["2026-03-03"]["owner/repo"].zh === "掉进来的中文", "a dated markdown sheet is the zh line");
  assert(dropped["2026-03-03"]["owner/repo"].en === "Dropped-in English", "a dated markdown sheet is the en line");
  assert(Object.keys(dropped).join() === "2026-03-03", "non-date files are not a sheet");
  assert(parseBlurbSheet("| plugin | 名称 | zh | en |\n| a/b | NAME | 中文 | EN |")["a/b"].zh === "中文", "名称 column is not the blurb");
} finally {
  await rm(sheetTmp, { recursive: true, force: true });
}

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
  const sheetBytes = await readFile(join(ROOT, "scripts/new-blurbs/2026-11-11.md"));
  assert(
    createHash("sha256").update(sheetBytes).digest("hex") ===
      "b69c91d0311fe242e1cc5e769321afe646f2c2abf0b05d4d4be89939a52457b8",
    "2026-11-11 writer sheet is the attached copy"
  );
  const sheet = parseBlurbSheet(sheetBytes.toString("utf8"));
  const sheetIds = Object.keys(sheet);
  assert(sheetIds.length === 42, "writer sheet has 42 plugins");
  const pinned = {
    "JiamingShi-JsPhys/chelate-shell": ["把本地技能编排成可按步骤执行的工作流", "Orchestrate local skills into step-by-step workflows"],
    "JiamingShi-JsPhys/web-forager": ["遵守 robots 规则做多引擎检索，并提取网页与常见文档", "Robots-aware multi-engine search and document extraction"],
    "puppetcat-fire/dsh-needs-archive": ["把用户原话归档，并可按主题或关键词回忆", "Archive the user's exact messages and recall them by topic or keyword"],
    "tiny-andr/dsh-chinese-cot": ["在系统提示最前面加一行可编辑内容，让模型用中文思考", "Add an editable line at the start of the system prompt so the model thinks in Chinese"],
    "lisusuba/Hardworking-donkey": ["按模型出词速度驱动的推磨驴背景", "A donkey-mill background paced by the model's token throughput"],
    "Dynesshely/dsh-plugin-btw": ["用 /btw 在侧栏提问，不影响主对话", "Ask a side question with /btw in a sidebar, without touching the main chat"],
    "bloodyxu/dsh-workspace-icons": ["为侧栏里的每个项目设置专属图标", "Give each project in the sidebar its own icon"],
    "2750599332-art/prompt-enhancer": ["一键把草稿提示改写成更清楚、可直接执行的版本", "One click rewrites a draft prompt into a clearer, executable version"],
  };
  for (const [id, [zh, en]] of Object.entries(pinned)) {
    assert(sheet[id].zh === zh, `${id} zh is the attached line`);
    assert(sheet[id].en === en, `${id} en is the attached line`);
  }
  const byId = new Map(catalog.plugins.map((plugin) => [plugin.id, plugin]));
  assert(rows.length === 42, "2026-11-11 still lists 42 eligible plugins");
  for (const id of sheetIds) {
    const row = rows.find((item) => item.id === id);
    const plugin = byId.get(id);
    assert(row, `${id} is listed on 2026-11-11`);
    assert(/[\u4e00-\u9fff]/.test(sheet[id].zh), `${id} zh is Chinese`);
    assert(/[A-Za-z]/.test(sheet[id].en), `${id} en is English`);
    assert(sheet[id].zh !== sheet[id].en, `${id} zh and en differ`);
    assert(row.zh === sheet[id].zh, `${id} chinese blurb is the writer line`);
    assert(row.en === sheet[id].en, `${id} english blurb is the writer line`);
    assert(row.name === plugin.name, `${id} display name stays ${plugin.name}`);
    assert(page.includes(`>${plugin.name}</a>`), `${id} anchor text is the catalog name`);
  }
  assert(rows.every((row) => sheet[row.id]), "every listed 2026-11-11 plugin has a writer line");
  assert(page.includes("data-zh=\"：把本地技能编排成可按步骤执行的工作流\""), "chinese blurb is the visible attribute");
  assert(
    page.includes("data-en=\"：Archive the user&#39;s exact messages and recall them by topic or keyword\""),
    "english blurb is escaped on the english attribute"
  );
  assert(page.includes(">：把用户原话归档，并可按主题或关键词回忆</span>"), "chinese page shows the zh line");
  assert(!page.includes("4f2dbb67"), "2026-11-11 page drops the uupm commit hash");
  assert(!page.includes("4-layer routing"), "2026-11-11 page drops the raw chelate blurb");
  assert(!page.includes("Hugeicons"), "2026-11-11 page drops the raw workspace-icons blurb");
  assert(page.includes("<title>今日新增插件 · dsplugin.app</title>"), "date title stays locked");
  assert(page.includes('data-title-en="Plugins added today · dsplugin.app"'), "english title stays locked");
  assert(
    page.includes('<h1 id="new-plugins-title" class="page-title" data-zh="今日新增插件" data-en="Plugins added today">今日新增插件</h1>'),
    "H1 stays locked"
  );
  assert(page.includes('rel="canonical" href="https://dsplugin.app/new"'), "date canonical stays /new");
  assert(!page.includes('rel="canonical" href="https://dsplugin.app/new/2026-11-11"'), "date page is not self-canonical");
  assert(page.includes('name="robots" content="noindex"'), "date page stays noindex");
  const hub = await readFile(join(catalogTmp, "new/index.html"), "utf8");
  assert(hub.includes("把本地技能编排成可按步骤执行的工作流"), "hub uses the same writer blurbs");
  assert(hub.includes("<title>今日新增插件 · dsplugin.app</title>"), "hub title stays locked");
  assert(hub.includes('rel="canonical" href="https://dsplugin.app/new"'), "hub canonical stays /new");
  assert(hub.includes('name="robots" content="noindex"'), "hub stays noindex");
  assert(!existsSync(join(catalogTmp, "plugins")), "new pages do not create /plugins landings");
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
