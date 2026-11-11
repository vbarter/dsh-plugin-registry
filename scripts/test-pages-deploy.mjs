// Pages upload: full catalog stays out of the asset dir, lite shards stay
// under 25 MiB, and the browser loader can put the shards back together.
//   node scripts/test-pages-deploy.mjs
import { existsSync } from "node:fs";
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
import { loadListRank } from "./list-rank.mjs";

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

const rank = loadListRank();
assert(rank.PAGE_SIZE === 60, "page size is 60");
assert(rank.defaultPageFile(1) === "list-default-001.json", "default page file is list-default-001.json");
assert(rank.defaultPageFile(12) === "list-default-012.json", "default page file pads to 3 digits");
const scoreNow = Date.parse("2026-11-11T00:00:00.000Z");
const day = 1000 * 60 * 60 * 24;
const scored = {
  stars: 10,
  forks: 5,
  source: "curated",
  pushedAt: "2026-11-01T00:00:00.000Z",
  verification: { manifest: "shape_validated" },
};
const expectedScore =
  10 * 2 +
  5 * 0.2 +
  180 +
  40 +
  Math.max(0, (Date.parse(scored.pushedAt) - scoreNow + day * 90) / day);
assert(rank.relevanceScore(scored, "", scoreNow) === expectedScore, "empty-query score formula");
const qPlugin = {
  name: "Alpha",
  owner: "ada",
  id: "ada/alpha",
  stars: 80,
  description: { zh: "终端", en: "terminal" },
  topics: ["tui"],
};
assert(
  rank.relevanceScore(qPlugin, "alpha", scoreNow) === 120 + 48 + 20 + Math.min(30, 80 / 80),
  "query score counts exact name, name substring, and id"
);
const order = [
  { id: "low", stars: 1 },
  { id: "high", stars: 9 },
];
const rankedTiny = rank.sortByRelevance(order, scoreNow);
assert(order.map((p) => p.id).join() === "low,high", "relevance sort does not mutate catalog order");
assert(rankedTiny.map((p) => p.id).join() === "high,low", "relevance sort orders by score");
const metaPlugins = [
  {
    owner: "a",
    stars: 2,
    category: "tools",
    language: "Go",
    install: "cmd-a",
    verification: { manifest: "shape_validated" },
    source: "curated",
  },
  { owner: "a", stars: 0, category: "tools", language: "Rust", source: "discovered" },
  { owner: "b", category: "ui", install: "cmd-b" },
];
const meta = rank.buildListMeta(metaPlugins, scoreNow);
assert(meta.count === 3 && meta.total === 3, "list meta count is plugins.length");
assert(meta.stars === 2, "list meta stars sum");
assert(meta.authors === 2, "list meta unique owners");
assert(meta.validated === 1, "list meta shape_validated count");
assert(meta.categoryCounts.tools === 2 && meta.categoryCounts.ui === 1, "list meta category counts");
assert(
  meta.languages.join() === ["Go", "Rust"].sort((a, b) => a.localeCompare(b)).join(),
  "list meta languages match buildLanguages sort"
);
assert(meta.installSamples.join() === "cmd-a,cmd-b", "list meta keeps the first install commands");
assert(meta.pageSize === 60 && meta.totalPages === 1, "list meta pageSize and totalPages");

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

const dsBotHtml = await readFile(join(ROOT, "plugins/ds-bot.html"), "utf8");
const dsBotInstall = "dsh plugin --profile web add github:Fei2411/DS-Bot#path:/ds-bot";
assert(dsBotHtml.includes("<title>ds-bot</title>"), "ds-bot title is exactly ds-bot");
assert(dsBotHtml.includes('<h1 class="page-title">ds-bot</h1>'), "ds-bot h1 is exactly ds-bot");
assert(
  dsBotHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/ds-bot">'),
  "ds-bot canonical"
);
assert(dsBotHtml.includes(dsBotInstall), "ds-bot install string includes #path:/ds-bot");
const dsBotWithoutInstall = dsBotHtml.split(dsBotInstall).join("");
assert(!dsBotWithoutInstall.includes("github:Fei2411/DS-Bot"), "no bare github:Fei2411/DS-Bot install target");
assert(!dsBotWithoutInstall.includes("dsh plugin"), "no second install command");
assert(!dsBotHtml.includes("<title>ds-bot｜"), "ds-bot title has no Chinese suffix");
assert(!/DS Bot|DeepSeek Bot/.test(dsBotHtml), "ds-bot page does not use DS Bot / DeepSeek Bot");

const scriptorHtml = await readFile(join(ROOT, "plugins/dsh-scriptor.html"), "utf8");
const scriptorInstall = "dsh plugin --profile web add @linfengqaqtat/dsh-scriptor";
assert(scriptorHtml.includes("<title>dsh-scriptor</title>"), "dsh-scriptor title is exactly dsh-scriptor");
assert(scriptorHtml.includes('<h1 class="page-title">dsh-scriptor</h1>'), "dsh-scriptor h1 is exactly dsh-scriptor");
assert(
  scriptorHtml.includes('<meta property="og:title" content="dsh-scriptor">'),
  "dsh-scriptor og:title is exactly dsh-scriptor"
);
assert(
  scriptorHtml.includes('<meta name="twitter:title" content="dsh-scriptor">'),
  "dsh-scriptor twitter:title is exactly dsh-scriptor"
);
assert(
  scriptorHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-scriptor">'),
  "dsh-scriptor canonical"
);
assert(
  scriptorHtml.includes("lingfengQAQ/webnovel-writer#packages/bundle"),
  "dsh-scriptor pins catalog id"
);
assert(scriptorHtml.includes(scriptorInstall), "dsh-scriptor install string");
assert(
  scriptorHtml.split(scriptorInstall).length - 1 === 3,
  "dsh-scriptor install string appears only in code, FAQ, and FAQ JSON-LD"
);
const scriptorWithoutInstall = scriptorHtml.split(scriptorInstall).join("");
assert(!scriptorWithoutInstall.includes("dsh plugin"), "no second dsh-scriptor install command");
assert(!scriptorWithoutInstall.includes("github:"), "no github: install form on dsh-scriptor");
assert(!scriptorHtml.includes("github:linfengqaqtat"), "no github:linfengqaqtat install");
assert(!scriptorHtml.includes("github:lingfengQAQ"), "no github:lingfengQAQ install");
assert(!/@linfengqaqtat\/dsh-scriptor@/.test(scriptorHtml), "no version-pinned second install");
assert(!scriptorHtml.includes("<title>dsh-scriptor｜"), "dsh-scriptor title has no Chinese suffix");
assert(!/<title>[^<]*(dsh-webnovel-writer|RrcoVer0)/.test(scriptorHtml), "lookalike is not the title");
assert(!/<h1[^>]*>[^<]*(dsh-webnovel-writer|RrcoVer0)/.test(scriptorHtml), "lookalike is not the h1");
const sitemapXml = await readFile(join(ROOT, "sitemap.xml"), "utf8");
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/dsh-scriptor</loc>"),
  "sitemap lists /plugins/dsh-scriptor"
);

const harnmemHtml = await readFile(join(ROOT, "plugins/dsh-harnmem.html"), "utf8");
const harnmemInstall = "dsh plugin --profile desktop add dsh-harnmem";
assert(harnmemHtml.includes("<title>dsh-harnmem</title>"), "dsh-harnmem title is exactly dsh-harnmem");
assert(harnmemHtml.includes('<h1 class="page-title">dsh-harnmem</h1>'), "dsh-harnmem h1 is exactly dsh-harnmem");
assert(
  harnmemHtml.includes('<meta property="og:title" content="dsh-harnmem">'),
  "dsh-harnmem og:title is exactly dsh-harnmem"
);
assert(
  harnmemHtml.includes('<meta name="twitter:title" content="dsh-harnmem">'),
  "dsh-harnmem twitter:title is exactly dsh-harnmem"
);
assert(
  harnmemHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-harnmem">'),
  "dsh-harnmem canonical"
);
assert(!/noindex/i.test(harnmemHtml), "dsh-harnmem has no noindex");
assert(
  harnmemHtml.includes("ys118/harnmem#packages/dsh-harnmem"),
  "dsh-harnmem pins catalog id"
);
assert(
  harnmemHtml.includes(
    "dsh-harnmem 是 HarnMem 给 DeepSeek Harness（DSH）的社区记忆插件（MIT，npm 包名 dsh-harnmem，源码在 ys118/harnmem 的 packages/dsh-harnmem）"
  ),
  "dsh-harnmem lead is the signed copy"
);
assert(
  harnmemHtml.includes("它是 HarnMem 的 DeepSeek Harness 社区记忆插件（包名 dsh-harnmem）"),
  "dsh-harnmem FAQ 1 matches signed copy"
);
assert(
  harnmemHtml.includes("不是 @harnmem/cli、不是 pi-harnmem，也不是 catalog 里无 install 的 harnmem-monorepo"),
  "dsh-harnmem FAQ 3 soft-disambiguates lookalikes"
);
assert(!harnmemHtml.includes("本页是占位"), "dsh-harnmem stub placeholder removed");
assert(!harnmemHtml.includes("正文以后替换"), "dsh-harnmem writer note removed");
assert(!harnmemHtml.includes("dsh-harnmem@"), "signed copy does not pin an npm version");
assert(harnmemHtml.includes("https://github.com/ys118/harnmem"), "dsh-harnmem upstream repo link");
assert(harnmemHtml.includes("packages/dsh-harnmem"), "dsh-harnmem package path");
assert(harnmemHtml.includes('class="evidence-grid cols-3"'), "dsh-harnmem uses cols-3 facts");
assert(!harnmemHtml.includes('data-fact="stars"'), "dsh-harnmem has no stars tile");
assert(harnmemHtml.includes(harnmemInstall), "dsh-harnmem install string");
assert(
  harnmemHtml.split(harnmemInstall).length - 1 === 3,
  "dsh-harnmem install string appears only in code, FAQ, and FAQ JSON-LD"
);
const harnmemWithoutInstall = harnmemHtml.split(harnmemInstall).join("");
assert(!harnmemWithoutInstall.includes("dsh plugin"), "no second dsh-harnmem install command");
assert(!harnmemHtml.includes("github:"), "no github: install form on dsh-harnmem");
assert(!harnmemHtml.includes("add dsh-harnmem@"), "no version-pinned second install");
assert(!harnmemHtml.includes("<title>dsh-harnmem｜"), "dsh-harnmem title has no Chinese suffix");
assert(!/<title>[^<]*(harnmem-monorepo|pi-harnmem|harnmem-cli)/.test(harnmemHtml), "lookalike is not the title");
assert(!/<h1[^>]*>[^<]*(harnmem-monorepo|pi-harnmem|harnmem-cli)/.test(harnmemHtml), "lookalike is not the h1");
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/dsh-harnmem</loc>"),
  "sitemap lists /plugins/dsh-harnmem"
);

const hongguoHtml = await readFile(join(ROOT, "plugins/dsh-hongguo.html"), "utf8");
const hongguoInstall = "dsh plugin --profile web add github:frostming/dsh-hongguo";
assert(hongguoHtml.includes("<title>dsh-hongguo</title>"), "dsh-hongguo title is exactly dsh-hongguo");
assert(hongguoHtml.includes('<h1 class="page-title">dsh-hongguo</h1>'), "dsh-hongguo h1 is exactly dsh-hongguo");
assert(
  hongguoHtml.includes('<meta property="og:title" content="dsh-hongguo">'),
  "dsh-hongguo og:title is exactly dsh-hongguo"
);
assert(
  hongguoHtml.includes('<meta name="twitter:title" content="dsh-hongguo">'),
  "dsh-hongguo twitter:title is exactly dsh-hongguo"
);
assert(
  hongguoHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-hongguo">'),
  "dsh-hongguo canonical"
);
assert(!/noindex/i.test(hongguoHtml), "dsh-hongguo has no noindex");
assert(hongguoHtml.includes('data-plugin-id="frostming/dsh-hongguo"'), "dsh-hongguo pins catalog id");
assert(
  hongguoHtml.includes(
    "dsh-hongguo（摸鱼短剧）是给 DeepSeek Harness（DSH）的社区插件：在右侧边栏播放短剧，Agent 工作时提示你把它调出来。数据来自 openhongguo（第三方短剧平台的非官方 SDK）。本页只对应目录 id"
  ),
  "dsh-hongguo lead is the signed copy"
);
assert(
  hongguoHtml.includes("它面向 DeepSeek Harness 的 web profile，在右侧边栏提供「摸鱼短剧」标签页"),
  "dsh-hongguo body is the signed copy"
);
assert(
  hongguoHtml.includes("请仅用于个人学习与研究，内容版权归权利人所有"),
  "dsh-hongguo keeps the study/copyright line"
);
assert(!hongguoHtml.includes("本页是占位"), "dsh-hongguo has no stub placeholder");
assert(!hongguoHtml.includes('data-fact="stars"'), "dsh-hongguo has no stars tile");
assert(hongguoHtml.includes("https://github.com/frostming/dsh-hongguo"), "dsh-hongguo repo link");
assert(hongguoHtml.includes('"softwareVersion": "1.2.1"'), "dsh-hongguo softwareVersion is 1.2.1");
assert(!/"softwareVersion": "(?!1\.2\.1")/.test(hongguoHtml), "dsh-hongguo has no other softwareVersion");
assert(hongguoHtml.includes(hongguoInstall), "dsh-hongguo install string");
assert(
  hongguoHtml.split(hongguoInstall).length - 1 === 3,
  "dsh-hongguo install string appears only in code, FAQ, and FAQ JSON-LD"
);
const hongguoWithoutInstall = hongguoHtml.split(hongguoInstall).join("");
assert(!hongguoWithoutInstall.includes("dsh plugin"), "no second dsh-hongguo install command");
assert(!hongguoWithoutInstall.includes("github:"), "no other github: install target on dsh-hongguo");
assert(!hongguoHtml.includes("npm install"), "no npm install on dsh-hongguo");
assert(!hongguoHtml.includes("<title>dsh-hongguo｜"), "dsh-hongguo title has no Chinese suffix");
assert(!/<h1[^>]*>摸鱼短剧</.test(hongguoHtml), "摸鱼短剧 is not the h1");
assert(!/<title>摸鱼短剧</.test(hongguoHtml), "摸鱼短剧 is not the title");
for (const term of [
  "ShoWin2333",
  "radish999",
  "NamiDSH",
  "dsh-game-studio",
  "CENC",
  "ffmpeg",
  "解密",
  "密钥",
  "下载量",
  "排名",
  "官方插件",
]) {
  assert(!hongguoHtml.includes(term), `dsh-hongguo page omits ${term}`);
}
const hongguoMain = hongguoHtml.split("<main")[1].split("</main>")[0];
assert(!hongguoMain.includes('href="/c/'), "dsh-hongguo main has no /c/ CTA");
const hongguoLd = JSON.parse(
  hongguoHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]
);
const hongguoFaqLd = hongguoLd["@graph"].find((node) => node["@type"] === "FAQPage");
const hongguoFaqHtml = [...hongguoHtml.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/gs)].map((m) => ({
  q: m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  a: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
}));
assert(hongguoFaqLd.mainEntity.length === 4, "dsh-hongguo FAQPage has 4 items");
assert(hongguoFaqHtml.length === 4, "dsh-hongguo HTML FAQ has 4 items");
for (let i = 0; i < 4; i++) {
  assert(hongguoFaqHtml[i].q === hongguoFaqLd.mainEntity[i].name, `dsh-hongguo FAQ ${i + 1} question matches JSON-LD`);
  assert(
    hongguoFaqHtml[i].a === hongguoFaqLd.mainEntity[i].acceptedAnswer.text,
    `dsh-hongguo FAQ ${i + 1} answer matches JSON-LD`
  );
}
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/dsh-hongguo</loc>"),
  "sitemap lists /plugins/dsh-hongguo"
);

const mediaDeskHtml = await readFile(join(ROOT, "plugins/dsh-media-desk.html"), "utf8");
const mediaDeskInstall = "dsh plugin --profile web add github:woniuniuniu/dsh-media-desk";
assert(mediaDeskHtml.includes("<title>dsh-media-desk</title>"), "dsh-media-desk title is exactly dsh-media-desk");
assert(mediaDeskHtml.includes('<h1 class="page-title">dsh-media-desk</h1>'), "dsh-media-desk h1 is exactly dsh-media-desk");
assert(
  mediaDeskHtml.includes('<meta property="og:title" content="dsh-media-desk">'),
  "dsh-media-desk og:title is exactly dsh-media-desk"
);
assert(
  mediaDeskHtml.includes('<meta name="twitter:title" content="dsh-media-desk">'),
  "dsh-media-desk twitter:title is exactly dsh-media-desk"
);
assert(
  mediaDeskHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-media-desk">'),
  "dsh-media-desk canonical"
);
assert(!/noindex/i.test(mediaDeskHtml), "dsh-media-desk has no noindex");
assert(mediaDeskHtml.includes('data-plugin-id="woniuniuniu/dsh-media-desk"'), "dsh-media-desk pins catalog id");
assert(
  mediaDeskHtml.includes(
    "dsh-media-desk（自媒体工作台）是给 DeepSeek Harness（DSH）的社区插件：一句话记下灵感，再生成口播脚本、标题、视频封面、配图和分镜。本页只对应目录 id"
  ),
  "dsh-media-desk lead is the signed copy"
);
assert(
  mediaDeskHtml.includes("它装在 DeepSeek Harness 的侧栏里，打开是一面灵感墙：一句话记一条灵感。"),
  "dsh-media-desk body is the signed copy"
);
assert(
  mediaDeskHtml.includes("请仅用于个人学习与研究，内容版权归权利人所有"),
  "dsh-media-desk keeps the study/copyright line"
);
assert(
  mediaDeskHtml.includes("各平台内容与素材的版权归权利人所有，请仅用于个人学习与研究"),
  "dsh-media-desk body keeps the signed copyright sentence"
);
assert(!mediaDeskHtml.includes("本页是占位"), "dsh-media-desk has no stub placeholder");
assert(!mediaDeskHtml.includes('data-fact="stars"'), "dsh-media-desk has no stars tile");
assert(mediaDeskHtml.includes("https://github.com/woniuniuniu/dsh-media-desk"), "dsh-media-desk repo link");
assert(mediaDeskHtml.includes('"softwareVersion": "2.6.1"'), "dsh-media-desk softwareVersion is 2.6.1");
assert(!/"softwareVersion": "(?!2\.6\.1")/.test(mediaDeskHtml), "dsh-media-desk has no other softwareVersion");
assert(mediaDeskHtml.includes(mediaDeskInstall), "dsh-media-desk install string");
assert(
  mediaDeskHtml.split(mediaDeskInstall).length - 1 === 3,
  "dsh-media-desk install string appears only in code, FAQ, and FAQ JSON-LD"
);
const mediaDeskWithoutInstall = mediaDeskHtml.split(mediaDeskInstall).join("");
assert(!mediaDeskWithoutInstall.includes("dsh plugin"), "no second dsh-media-desk install command");
assert(!mediaDeskWithoutInstall.includes("github:"), "no other github: install target on dsh-media-desk");
assert(!mediaDeskWithoutInstall.includes("add dsh-media-desk"), "no short-form add dsh-media-desk");
assert(!mediaDeskHtml.includes("--profile desktop"), "no desktop profile on dsh-media-desk");
assert(!mediaDeskHtml.includes("npm install"), "no npm install on dsh-media-desk");
assert(!mediaDeskHtml.includes("<title>dsh-media-desk｜"), "dsh-media-desk title has no Chinese suffix");
assert(!/<h1[^>]*>自媒体工作台</.test(mediaDeskHtml), "自媒体工作台 is not the h1");
assert(!/<title>自媒体工作台</.test(mediaDeskHtml), "自媒体工作台 is not the title");
assert(!/<title>[^<]*自媒体工作台/.test(mediaDeskHtml), "title does not include 自媒体工作台");
assert(!/<h1[^>]*>[^<]*自媒体工作台/.test(mediaDeskHtml), "h1 does not include 自媒体工作台");
for (const term of [
  "Letter2025",
  "vibeinging",
  "dsh-tool-search",
  "FreeCAD",
  "Negulons",
  "dsh-freecad",
  "NamiDSH",
  "dsh-game-studio",
  "ShoWin2333",
  "radish999",
  "下载量",
  "排名",
  "官方插件",
  "340",
  "345",
]) {
  assert(!mediaDeskHtml.includes(term), `dsh-media-desk page omits ${term}`);
}
const mediaDeskMain = mediaDeskHtml.split("<main")[1].split("</main>")[0];
assert(!mediaDeskMain.includes('href="/c/'), "dsh-media-desk main has no /c/ CTA");
assert(!mediaDeskMain.includes("官方"), "dsh-media-desk main does not call the plugin 官方");
const mediaDeskLd = JSON.parse(
  mediaDeskHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]
);
const mediaDeskFaqLd = mediaDeskLd["@graph"].find((node) => node["@type"] === "FAQPage");
const mediaDeskFaqHtml = [...mediaDeskHtml.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/gs)].map((m) => ({
  q: m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  a: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
}));
assert(mediaDeskFaqLd.mainEntity.length === 4, "dsh-media-desk FAQPage has 4 items");
assert(mediaDeskFaqHtml.length === 4, "dsh-media-desk HTML FAQ has 4 items");
for (let i = 0; i < 4; i++) {
  assert(mediaDeskFaqHtml[i].q === mediaDeskFaqLd.mainEntity[i].name, `dsh-media-desk FAQ ${i + 1} question matches JSON-LD`);
  assert(
    mediaDeskFaqHtml[i].a === mediaDeskFaqLd.mainEntity[i].acceptedAnswer.text,
    `dsh-media-desk FAQ ${i + 1} answer matches JSON-LD`
  );
}
assert(
  mediaDeskFaqLd.mainEntity[1].acceptedAnswer.text.startsWith(mediaDeskInstall),
  "dsh-media-desk FAQPage answer 2 starts with the install command"
);
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/dsh-media-desk</loc>"),
  "sitemap lists /plugins/dsh-media-desk"
);
assert(
  /<loc>https:\/\/dsplugin\.app\/plugins\/dsh-media-desk<\/loc>\s*<lastmod>2026-11-07<\/lastmod>/.test(sitemapXml),
  "sitemap lastmod for dsh-media-desk is 2026-11-07"
);
assert(!existsSync(join(ROOT, "c/dsh-media-desk.html")), "no /c/dsh-media-desk page");

const infiniteCanvasHtml = await readFile(join(ROOT, "plugins/dsh-infinite_canvas.html"), "utf8");
const infiniteCanvasInstall = "dsh plugin --profile web add github:NINKCH/dsh-infinite_canvas";
const infiniteCanvasPkg = "@ninkch/dsh-infinite-canvas";
assert(infiniteCanvasHtml.includes("<title>dsh-infinite_canvas</title>"), "dsh-infinite_canvas title is exactly dsh-infinite_canvas");
assert(
  infiniteCanvasHtml.includes('<h1 class="page-title">dsh-infinite_canvas</h1>'),
  "dsh-infinite_canvas h1 is exactly dsh-infinite_canvas"
);
assert(
  infiniteCanvasHtml.includes('<meta property="og:title" content="dsh-infinite_canvas">'),
  "dsh-infinite_canvas og:title is exactly dsh-infinite_canvas"
);
assert(
  infiniteCanvasHtml.includes('<meta name="twitter:title" content="dsh-infinite_canvas">'),
  "dsh-infinite_canvas twitter:title is exactly dsh-infinite_canvas"
);
assert(
  infiniteCanvasHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-infinite_canvas">'),
  "dsh-infinite_canvas canonical"
);
assert(!/noindex/i.test(infiniteCanvasHtml), "dsh-infinite_canvas has no noindex");
assert(
  infiniteCanvasHtml.includes('data-plugin-id="NINKCH/dsh-infinite_canvas"'),
  "dsh-infinite_canvas pins catalog id"
);
assert(
  infiniteCanvasHtml.includes(
    "dsh-infinite_canvas（无限画布）是给 DeepSeek Harness（DSH）的社区插件：在侧栏打开节点式短剧工作室，从一句话灵感走到剧本、分镜、参考素材、多镜头生成与成片剪辑。本页只对应目录 id"
  ),
  "dsh-infinite_canvas lead is the signed copy"
);
assert(
  infiniteCanvasHtml.includes("它把 DeepSeek Harness 的右侧边栏变成一块无限画布：用节点串起短剧流水线"),
  "dsh-infinite_canvas body is the signed copy"
);
assert(
  infiniteCanvasHtml.includes("请仅用于个人学习与研究，内容与素材的版权归权利人所有"),
  "dsh-infinite_canvas keeps the study/copyright line"
);
assert(!infiniteCanvasHtml.includes("本页是占位"), "dsh-infinite_canvas has no stub placeholder");
assert(!infiniteCanvasHtml.includes("合入备注"), "dsh-infinite_canvas omits the writer note");
assert(!infiniteCanvasHtml.includes('data-fact="stars"'), "dsh-infinite_canvas has no stars tile");
assert(infiniteCanvasHtml.includes("https://github.com/NINKCH/dsh-infinite_canvas"), "dsh-infinite_canvas repo link");
assert(infiniteCanvasHtml.includes('"softwareVersion": "0.20.1"'), "dsh-infinite_canvas softwareVersion is 0.20.1");
assert(!/"softwareVersion": "(?!0\.20\.1")/.test(infiniteCanvasHtml), "dsh-infinite_canvas has no other softwareVersion");
assert(infiniteCanvasHtml.includes(infiniteCanvasInstall), "dsh-infinite_canvas install string");
assert(
  infiniteCanvasHtml.split(infiniteCanvasInstall).length - 1 === 3,
  "dsh-infinite_canvas install string appears only in code, FAQ, and FAQ JSON-LD"
);
const infiniteCanvasWithoutInstall = infiniteCanvasHtml.split(infiniteCanvasInstall).join("");
assert(!infiniteCanvasWithoutInstall.includes("dsh plugin"), "no second dsh-infinite_canvas install command");
assert(!infiniteCanvasWithoutInstall.includes("github:"), "no other github: install target on dsh-infinite_canvas");
assert(!infiniteCanvasWithoutInstall.includes("--profile"), "no second profile on dsh-infinite_canvas");
assert(!infiniteCanvasHtml.includes("add dsh-infinite_canvas"), "no short-form add dsh-infinite_canvas");
assert(!infiniteCanvasHtml.includes("add dsh-infinite-canvas"), "no short-form add dsh-infinite-canvas");
assert(!infiniteCanvasHtml.includes("--profile desktop"), "no desktop profile on dsh-infinite_canvas");
assert(!infiniteCanvasHtml.includes("npm install"), "no npm install on dsh-infinite_canvas");
assert(!infiniteCanvasHtml.includes("<title>dsh-infinite_canvas｜"), "dsh-infinite_canvas title has no Chinese suffix");
assert(!/<title>[^<]*无限画布/.test(infiniteCanvasHtml), "无限画布 is not in the title");
assert(!/<h1[^>]*>[^<]*无限画布/.test(infiniteCanvasHtml), "无限画布 is not in the h1");
assert(!/<title>[^<]*短剧/.test(infiniteCanvasHtml), "短剧 is not in the title");
assert(!/<h1[^>]*>[^<]*短剧/.test(infiniteCanvasHtml), "短剧 is not in the h1");
assert(!infiniteCanvasHtml.includes("<title>dsh-infinite-canvas</title>"), "hyphen slug is not the title");
assert(
  !infiniteCanvasHtml.includes('<h1 class="page-title">dsh-infinite-canvas</h1>'),
  "hyphen slug is not the h1"
);
assert(
  !infiniteCanvasHtml.includes("https://dsplugin.app/plugins/dsh-infinite-canvas"),
  "hyphen slug is not a canonical or url"
);
assert(
  infiniteCanvasHtml.split(infiniteCanvasPkg).length - 1 === 3,
  "package name appears only as a non-install clarification"
);
assert(
  !infiniteCanvasHtml.split(infiniteCanvasPkg).join("").includes("dsh-infinite-canvas"),
  "hyphen slug is not used outside the package-name clarification"
);
for (const term of [
  "自媒体",
  "摸鱼短剧",
  "TNTest",
  "Haitang-Hub",
  "CapCut",
  "FreeCAD",
  "NamiDSH",
  "dsh-game-studio",
  "下载量",
  "排名",
  "官方插件",
]) {
  assert(!infiniteCanvasHtml.includes(term), `dsh-infinite_canvas page omits ${term}`);
}
const infiniteCanvasMain = infiniteCanvasHtml.split("<main")[1].split("</main>")[0];
assert(!infiniteCanvasMain.includes('href="/c/'), "dsh-infinite_canvas main has no /c/ CTA");
assert(!infiniteCanvasMain.includes("官方"), "dsh-infinite_canvas main does not call the plugin 官方");
const infiniteCanvasLd = JSON.parse(
  infiniteCanvasHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]
);
const infiniteCanvasFaqLd = infiniteCanvasLd["@graph"].find((node) => node["@type"] === "FAQPage");
const infiniteCanvasFaqHtml = [...infiniteCanvasHtml.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/gs)].map((m) => ({
  q: m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  a: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
}));
assert(infiniteCanvasFaqLd.mainEntity.length === 4, "dsh-infinite_canvas FAQPage has 4 items");
assert(infiniteCanvasFaqHtml.length === 4, "dsh-infinite_canvas HTML FAQ has 4 items");
for (let i = 0; i < 4; i++) {
  assert(
    infiniteCanvasFaqHtml[i].q === infiniteCanvasFaqLd.mainEntity[i].name,
    `dsh-infinite_canvas FAQ ${i + 1} question matches JSON-LD`
  );
  assert(
    infiniteCanvasFaqHtml[i].a === infiniteCanvasFaqLd.mainEntity[i].acceptedAnswer.text,
    `dsh-infinite_canvas FAQ ${i + 1} answer matches JSON-LD`
  );
}
assert(
  infiniteCanvasFaqLd.mainEntity[1].acceptedAnswer.text.startsWith(infiniteCanvasInstall),
  "dsh-infinite_canvas FAQPage answer 2 starts with the install command"
);
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/dsh-infinite_canvas</loc>"),
  "sitemap lists /plugins/dsh-infinite_canvas"
);
assert(
  /<loc>https:\/\/dsplugin\.app\/plugins\/dsh-infinite_canvas<\/loc>\s*<lastmod>2026-11-07<\/lastmod>/.test(sitemapXml),
  "sitemap lastmod for dsh-infinite_canvas is 2026-11-07"
);
assert(!sitemapXml.includes("dsh-infinite-canvas"), "sitemap has no hyphen lookalike");
assert(!existsSync(join(ROOT, "plugins/dsh-infinite-canvas.html")), "no hyphen slug page");
assert(!existsSync(join(ROOT, "c/dsh-infinite_canvas.html")), "no /c/dsh-infinite_canvas page");

const agenteroHtml = await readFile(join(ROOT, "plugins/agentero-dsh-plugin.html"), "utf8");
const agenteroInstall = "dsh plugin --profile web add github:poco-ai/agentero-dsh-plugin";
const agenteroMeta =
  "agentero-dsh-plugin 是 DeepSeek Harness 的社区科研文献库插件：搜论文、带出处、审批入库，并把笔记线索交给同会话其他插件（本地 Agentero Vault）。目录 id poco-ai/agentero-dsh-plugin。安装：dsh plugin --profile web add github:poco-ai/agentero-dsh-plugin。";
const agenteroPkg = "@poco-ai/agentero-dsh";
assert(agenteroHtml.includes("<title>agentero-dsh-plugin</title>"), "agentero-dsh-plugin title is exactly agentero-dsh-plugin");
assert(
  agenteroHtml.includes('<h1 class="page-title">agentero-dsh-plugin</h1>'),
  "agentero-dsh-plugin h1 is exactly agentero-dsh-plugin"
);
assert(
  agenteroHtml.includes('<meta property="og:title" content="agentero-dsh-plugin">'),
  "agentero-dsh-plugin og:title is exactly agentero-dsh-plugin"
);
assert(
  agenteroHtml.includes('<meta name="twitter:title" content="agentero-dsh-plugin">'),
  "agentero-dsh-plugin twitter:title is exactly agentero-dsh-plugin"
);
assert(
  agenteroHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/agentero-dsh-plugin">'),
  "agentero-dsh-plugin canonical"
);
assert(!/noindex/i.test(agenteroHtml), "agentero-dsh-plugin has no noindex");
assert(
  agenteroHtml.includes('data-plugin-id="poco-ai/agentero-dsh-plugin"'),
  "agentero-dsh-plugin pins catalog id"
);
assert(
  agenteroHtml.includes(`<meta name="description" content="${agenteroMeta}">`),
  "agentero-dsh-plugin meta description is the signed suggestion"
);
assert(
  agenteroHtml.includes(`<meta property="og:description" content="${agenteroMeta}">`),
  "agentero-dsh-plugin og:description matches the signed meta"
);
assert(
  agenteroHtml.includes(`<meta name="twitter:description" content="${agenteroMeta}">`),
  "agentero-dsh-plugin twitter:description matches the signed meta"
);
assert(
  agenteroHtml.includes(
    "agentero-dsh-plugin（科研文献库）是给 DeepSeek Harness（DSH）的社区插件：在本地 Agentero Vault 里搜论文、带出处回答、审批后入库，并把笔记线索交给同会话其他插件。本页只对应目录 id"
  ),
  "agentero-dsh-plugin lead is the signed copy"
);
assert(
  agenteroHtml.includes("它把本地优先的科研文献库带进 DeepSeek Harness：聊天在中间，论文与 PDF 在侧栏。"),
  "agentero-dsh-plugin body is the signed copy"
);
assert(
  agenteroHtml.includes("请仅用于个人学习与研究，论文与素材的版权归权利人所有"),
  "agentero-dsh-plugin keeps the study/copyright line"
);
assert(!agenteroHtml.includes("本页是占位"), "agentero-dsh-plugin has no stub placeholder");
assert(!agenteroHtml.includes("合入备注"), "agentero-dsh-plugin omits the writer note");
assert(!agenteroHtml.includes('data-fact="stars"'), "agentero-dsh-plugin has no stars tile");
assert(agenteroHtml.includes("https://github.com/poco-ai/agentero-dsh-plugin"), "agentero-dsh-plugin repo link");
assert(agenteroHtml.includes('"softwareVersion": "0.1.7"'), "agentero-dsh-plugin softwareVersion is 0.1.7");
assert(!/"softwareVersion": "(?!0\.1\.7")/.test(agenteroHtml), "agentero-dsh-plugin has no other softwareVersion");
assert(agenteroHtml.includes(agenteroInstall), "agentero-dsh-plugin install string");
assert(
  agenteroHtml.split(agenteroInstall).length - 1 === 7,
  "agentero-dsh-plugin install string is the signed meta (meta/og/twitter/WebSite) plus code, FAQ, and FAQ JSON-LD"
);
const agenteroWithoutInstall = agenteroHtml.split(agenteroInstall).join("");
assert(!agenteroWithoutInstall.includes("dsh plugin"), "no second agentero-dsh-plugin install command");
assert(!agenteroWithoutInstall.includes("github:"), "no other github: install target on agentero-dsh-plugin");
assert(!agenteroWithoutInstall.includes("--profile"), "no second profile on agentero-dsh-plugin");
assert(!agenteroHtml.includes("add agentero-dsh"), "no short-form add agentero-dsh");
assert(!agenteroHtml.includes("add agentero-dsh-plugin"), "no short-form add agentero-dsh-plugin");
assert(!agenteroHtml.includes("--profile desktop"), "no desktop profile on agentero-dsh-plugin");
assert(!agenteroHtml.includes("npm install"), "no npm install on agentero-dsh-plugin");
assert(!agenteroHtml.includes("npm i "), "no npm i on agentero-dsh-plugin");
assert(!agenteroHtml.includes("<title>agentero-dsh-plugin｜"), "agentero-dsh-plugin title has no Chinese suffix");
assert(!/<title>[^<]*科研文献库/.test(agenteroHtml), "科研文献库 is not in the title");
assert(!/<h1[^>]*>[^<]*科研文献库/.test(agenteroHtml), "科研文献库 is not in the h1");
assert(!/<title>[^<]*搜论文/.test(agenteroHtml), "搜论文 is not in the title");
assert(!/<h1[^>]*>[^<]*搜论文/.test(agenteroHtml), "搜论文 is not in the h1");
assert(!/<title>agentero<\/title>/.test(agenteroHtml), "bare agentero is not the title");
assert(!agenteroHtml.includes('<h1 class="page-title">agentero</h1>'), "bare agentero is not the h1");
assert(
  agenteroHtml.split(agenteroPkg).length - 1 === 3,
  "scoped package name appears only as a non-install clarification"
);
assert(
  agenteroHtml.split(agenteroPkg).join("").split("agentero-dsh-plugin").join("").split("agentero-dsh").length - 1 === 1,
  "short agentero-dsh appears only in the body clarification"
);
assert(
  agenteroHtml.includes("（短名 <code>agentero-dsh</code>）不是安装命令"),
  "short name is marked as not the install command"
);
for (const term of [
  "yellkiin",
  "dsh-agentero-annotations",
  "web_search",
  "Bing",
  "bing",
  "免费搜索",
  "搜索插件",
  "下载量",
  "排名",
  "官方插件",
  "合入备注",
]) {
  assert(!agenteroHtml.includes(term), `agentero-dsh-plugin page omits ${term}`);
}
const agenteroMain = agenteroHtml.split("<main")[1].split("</main>")[0];
assert(!agenteroMain.includes('href="/c/'), "agentero-dsh-plugin main has no /c/ CTA");
assert(!agenteroMain.includes("官方"), "agentero-dsh-plugin main does not call the plugin 官方");
const agenteroLd = JSON.parse(
  agenteroHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]
);
const agenteroFaqLd = agenteroLd["@graph"].find((node) => node["@type"] === "FAQPage");
const agenteroFaqHtml = [...agenteroHtml.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/gs)].map((m) => ({
  q: m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  a: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
}));
assert(agenteroFaqLd.mainEntity.length === 4, "agentero-dsh-plugin FAQPage has 4 items");
assert(agenteroFaqHtml.length === 4, "agentero-dsh-plugin HTML FAQ has 4 items");
for (let i = 0; i < 4; i++) {
  assert(
    agenteroFaqHtml[i].q === agenteroFaqLd.mainEntity[i].name,
    `agentero-dsh-plugin FAQ ${i + 1} question matches JSON-LD`
  );
  assert(
    agenteroFaqHtml[i].a === agenteroFaqLd.mainEntity[i].acceptedAnswer.text,
    `agentero-dsh-plugin FAQ ${i + 1} answer matches JSON-LD`
  );
}
assert(
  agenteroFaqLd.mainEntity[1].acceptedAnswer.text.startsWith(agenteroInstall),
  "agentero-dsh-plugin FAQPage answer 2 starts with the install command"
);
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/agentero-dsh-plugin</loc>"),
  "sitemap lists /plugins/agentero-dsh-plugin"
);
assert(
  /<loc>https:\/\/dsplugin\.app\/plugins\/agentero-dsh-plugin<\/loc>\s*<lastmod>2026-11-09<\/lastmod>/.test(sitemapXml),
  "sitemap lastmod for agentero-dsh-plugin is 2026-11-09"
);
assert(!sitemapXml.includes("https://dsplugin.app/plugins/agentero-dsh<"), "sitemap has no agentero-dsh lookalike");
assert(!sitemapXml.includes("https://dsplugin.app/plugins/dsh-agentero"), "sitemap has no dsh-agentero lookalike");
assert(!sitemapXml.includes("https://dsplugin.app/plugins/agentero<"), "sitemap has no bare agentero lookalike");
assert(!sitemapXml.includes("https://dsplugin.app/c/agentero"), "sitemap has no /c/agentero URL");
assert(!existsSync(join(ROOT, "plugins/agentero-dsh.html")), "no /plugins/agentero-dsh page");
assert(!existsSync(join(ROOT, "plugins/dsh-agentero.html")), "no /plugins/dsh-agentero page");
assert(!existsSync(join(ROOT, "plugins/agentero.html")), "no /plugins/agentero page");
assert(!existsSync(join(ROOT, "c/agentero-dsh-plugin.html")), "no /c/agentero-dsh-plugin page");

const providersHtml = await readFile(join(ROOT, "plugins/dsh-providers-hub.html"), "utf8");
const providersInstall = "dsh plugin --profile web add github:iJetLi/dsh-providers-hub";
const providersMeta =
  "dsh-providers-hub 是 DeepSeek Harness 的社区多服务账号中枢插件：在 Jet Hub 登录并管理多家 AI 编程服务账号，支持多账号池与凭据静默续期，并把模型接到 DSH 选择器。目录 id iJetLi/dsh-providers-hub。安装：dsh plugin --profile web add github:iJetLi/dsh-providers-hub。";
const providersOldName = "dsh-codearts-auth";
assert(providersHtml.includes("<title>dsh-providers-hub</title>"), "dsh-providers-hub title is exactly dsh-providers-hub");
assert(
  providersHtml.includes('<h1 class="page-title">dsh-providers-hub</h1>'),
  "dsh-providers-hub h1 is exactly dsh-providers-hub"
);
assert(
  providersHtml.includes('<meta property="og:title" content="dsh-providers-hub">'),
  "dsh-providers-hub og:title is exactly dsh-providers-hub"
);
assert(
  providersHtml.includes('<meta name="twitter:title" content="dsh-providers-hub">'),
  "dsh-providers-hub twitter:title is exactly dsh-providers-hub"
);
assert(
  providersHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-providers-hub">'),
  "dsh-providers-hub canonical"
);
assert(!/noindex/i.test(providersHtml), "dsh-providers-hub has no noindex");
assert(
  providersHtml.includes('data-plugin-id="iJetLi/dsh-providers-hub"'),
  "dsh-providers-hub pins catalog id"
);
assert(
  providersHtml.includes(`<meta name="description" content="${providersMeta}">`),
  "dsh-providers-hub meta description is the signed suggestion"
);
assert(
  providersHtml.includes(`<meta property="og:description" content="${providersMeta}">`),
  "dsh-providers-hub og:description matches the signed meta"
);
assert(
  providersHtml.includes(`<meta name="twitter:description" content="${providersMeta}">`),
  "dsh-providers-hub twitter:description matches the signed meta"
);
assert(
  providersHtml.includes(
    "dsh-providers-hub（多服务账号中枢）是给 DeepSeek Harness（DSH）的社区插件：在 Jet Hub 里登录并管理多家 AI 编程服务账号，支持多账号池与凭据静默续期，并把这些渠道的模型接到 DSH 模型选择器。本页只对应目录 id"
  ),
  "dsh-providers-hub lead is the signed copy"
);
assert(
  providersHtml.includes("它把多家 AI 编程服务的账号收进同一个 Jet Hub 面板：登录、查看状态、凭据续期和积分领取都在设置页完成，不注册斜杠命令。"),
  "dsh-providers-hub body is the signed copy"
);
assert(
  providersHtml.includes("请仅用于个人学习与研究，并遵守各服务提供方的服务条款；内容与素材的版权归权利人所有。"),
  "dsh-providers-hub keeps the study/service-terms/copyright line"
);
assert(!providersHtml.includes("本页是占位"), "dsh-providers-hub has no stub placeholder");
assert(!providersHtml.includes("合入备注"), "dsh-providers-hub omits the writer note");
assert(!providersHtml.includes('data-fact="stars"'), "dsh-providers-hub has no stars tile");
assert(providersHtml.includes("https://github.com/iJetLi/dsh-providers-hub"), "dsh-providers-hub repo link");
assert(providersHtml.includes('"softwareVersion": "0.2.1-rc.2"'), "dsh-providers-hub softwareVersion is 0.2.1-rc.2");
assert(!/"softwareVersion": "(?!0\.2\.1-rc\.2")/.test(providersHtml), "dsh-providers-hub has no other softwareVersion");
assert(providersHtml.includes(providersInstall), "dsh-providers-hub install string");
assert(
  providersHtml.split(providersInstall).length - 1 === 7,
  "dsh-providers-hub install string is the signed meta (meta/og/twitter/WebSite) plus code, FAQ, and FAQ JSON-LD"
);
const providersWithoutInstall = providersHtml.split(providersInstall).join("");
assert(!providersWithoutInstall.includes("dsh plugin"), "no second dsh-providers-hub install command");
assert(!providersWithoutInstall.includes("github:"), "no other github: install target on dsh-providers-hub");
assert(!providersWithoutInstall.includes("--profile"), "no second profile on dsh-providers-hub");
assert(!providersHtml.includes("add dsh-providers-hub"), "no short-form add dsh-providers-hub");
assert(!providersHtml.includes("add providers-hub"), "no short-form add providers-hub");
assert(!providersHtml.includes("--profile desktop"), "no desktop profile on dsh-providers-hub");
assert(!providersHtml.includes("npm install"), "no npm install on dsh-providers-hub");
assert(!providersHtml.includes("npm i "), "no npm i on dsh-providers-hub");
assert(!providersHtml.includes("gitee.com"), "no gitee install URL on dsh-providers-hub");
assert(!providersHtml.includes("<title>dsh-providers-hub｜"), "dsh-providers-hub title has no Chinese suffix");
assert(!/<title>[^<]*多服务账号中枢/.test(providersHtml), "多服务账号中枢 is not in the title");
assert(!/<h1[^>]*>[^<]*多服务账号中枢/.test(providersHtml), "多服务账号中枢 is not in the h1");
assert(!/<title>providers-hub<\/title>/.test(providersHtml), "bare providers-hub is not the title");
assert(!providersHtml.includes('<h1 class="page-title">providers-hub</h1>'), "bare providers-hub is not the h1");
assert(!/<title>dsh-providers<\/title>/.test(providersHtml), "dsh-providers is not the title");
assert(!providersHtml.includes('<h1 class="page-title">dsh-providers</h1>'), "dsh-providers is not the h1");
assert(!/<title>dsh-provider-hub<\/title>/.test(providersHtml), "dsh-provider-hub is not the title");
assert(!providersHtml.includes('<h1 class="page-title">dsh-provider-hub</h1>'), "dsh-provider-hub is not the h1");
assert(
  providersHtml.split(providersOldName).length - 1 === 3,
  "old package name appears only in body, FAQ #3, and FAQ JSON-LD"
);
assert(
  providersHtml.includes("本包曾用名 <code>dsh-codearts-auth</code> 同样不是安装命令"),
  "old package name in the body is marked as not the install command"
);
assert(
  providersHtml.includes("本包曾用名 dsh-codearts-auth 不是本页的安装命令"),
  "old package name in FAQ JSON-LD is marked as not the install command"
);
for (const term of [
  "MaoYouShiJie",
  "yellkiin",
  "anvilsong",
  "dsh-plugin-provider-usage",
  "web_search",
  "Bing",
  "bing",
  "免费搜索",
  "搜索插件",
  "下载量",
  "排名",
  "官方插件",
  "合入备注",
]) {
  assert(!providersHtml.includes(term), `dsh-providers-hub page omits ${term}`);
}
const providersMain = providersHtml.split("<main")[1].split("</main>")[0];
assert(!providersMain.includes('href="/c/'), "dsh-providers-hub main has no /c/ CTA");
assert(!providersMain.includes("官方"), "dsh-providers-hub main does not call the plugin 官方");
const providersLd = JSON.parse(
  providersHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]
);
const providersFaqLd = providersLd["@graph"].find((node) => node["@type"] === "FAQPage");
const providersAppLd = providersLd["@graph"].find((node) => node["@type"] === "SoftwareApplication");
const providersCrumbLd = providersLd["@graph"].find((node) => node["@type"] === "BreadcrumbList");
assert(providersAppLd.name === "dsh-providers-hub", "SoftwareApplication name is dsh-providers-hub");
assert(
  providersCrumbLd.itemListElement[1].name === "dsh-providers-hub",
  "BreadcrumbList name is dsh-providers-hub"
);
const providersFaqHtml = [...providersHtml.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/gs)].map((m) => ({
  q: m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  a: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
}));
assert(providersFaqLd.mainEntity.length === 4, "dsh-providers-hub FAQPage has 4 items");
assert(providersFaqHtml.length === 4, "dsh-providers-hub HTML FAQ has 4 items");
for (let i = 0; i < 4; i++) {
  assert(
    providersFaqHtml[i].q === providersFaqLd.mainEntity[i].name,
    `dsh-providers-hub FAQ ${i + 1} question matches JSON-LD`
  );
  assert(
    providersFaqHtml[i].a === providersFaqLd.mainEntity[i].acceptedAnswer.text,
    `dsh-providers-hub FAQ ${i + 1} answer matches JSON-LD`
  );
}
assert(
  providersFaqLd.mainEntity[1].acceptedAnswer.text.startsWith(providersInstall),
  "dsh-providers-hub FAQPage answer 2 starts with the install command"
);
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/dsh-providers-hub</loc>"),
  "sitemap lists /plugins/dsh-providers-hub"
);
assert(
  /<loc>https:\/\/dsplugin\.app\/plugins\/dsh-providers-hub<\/loc>\s*<lastmod>2026-11-10<\/lastmod>/.test(sitemapXml),
  "sitemap lastmod for dsh-providers-hub is 2026-11-10"
);
assert(!sitemapXml.includes("https://dsplugin.app/plugins/providers-hub"), "sitemap has no bare providers-hub");
assert(!sitemapXml.includes("https://dsplugin.app/plugins/dsh-providers<"), "sitemap has no dsh-providers lookalike");
assert(!sitemapXml.includes("https://dsplugin.app/plugins/dsh-provider-hub"), "sitemap has no dsh-provider-hub lookalike");
assert(!sitemapXml.includes("dsh-codearts-auth"), "sitemap has no dsh-codearts-auth");
assert(!sitemapXml.includes("https://dsplugin.app/c/dsh-providers-hub"), "sitemap has no /c/dsh-providers-hub URL");
assert(!sitemapXml.includes("iJetLi-dsh-providers-hub"), "sitemap has no owner-hyphen lookalike");
assert(!existsSync(join(ROOT, "plugins/providers-hub.html")), "no /plugins/providers-hub page");
assert(!existsSync(join(ROOT, "plugins/dsh-providers.html")), "no /plugins/dsh-providers page");
assert(!existsSync(join(ROOT, "plugins/dsh-provider-hub.html")), "no /plugins/dsh-provider-hub page");
assert(!existsSync(join(ROOT, "plugins/dsh-codearts-auth.html")), "no /plugins/dsh-codearts-auth page");
assert(!existsSync(join(ROOT, "plugins/iJetLi-dsh-providers-hub.html")), "no owner-hyphen page");
assert(!existsSync(join(ROOT, "c/dsh-providers-hub.html")), "no /c/dsh-providers-hub page");

const iosHtml = await readFile(join(ROOT, "plugins/dsh-ios.html"), "utf8");
const iosInstall = "dsh plugin --profile web add github:ZSeven-W/dsh-ios";
const iosMeta =
  "dsh-ios 是 DeepSeek Harness 的社区插件：在会话里接入 iOS Simulator 以及 USB 连接的 iPhone 真机流，支持构建、运行、无障碍或 OCR 操作，并在侧栏预览。目录 id ZSeven-W/dsh-ios。安装：dsh plugin --profile web add github:ZSeven-W/dsh-ios。";
const iosPkg = "@zseven-w/dsh-ios";
assert(iosHtml.includes("<title>dsh-ios</title>"), "dsh-ios title is exactly dsh-ios");
assert(iosHtml.includes('<h1 class="page-title">dsh-ios</h1>'), "dsh-ios h1 is exactly dsh-ios");
assert(iosHtml.includes('<meta property="og:title" content="dsh-ios">'), "dsh-ios og:title is exactly dsh-ios");
assert(iosHtml.includes('<meta name="twitter:title" content="dsh-ios">'), "dsh-ios twitter:title is exactly dsh-ios");
assert(
  iosHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-ios">'),
  "dsh-ios canonical"
);
assert(!/noindex/i.test(iosHtml), "dsh-ios has no noindex");
assert(iosHtml.includes('data-plugin-id="ZSeven-W/dsh-ios"'), "dsh-ios pins catalog id");
assert(iosHtml.includes(`<meta name="description" content="${iosMeta}">`), "dsh-ios meta description is the signed suggestion");
assert(iosHtml.includes(`<meta property="og:description" content="${iosMeta}">`), "dsh-ios og:description matches the signed meta");
assert(iosHtml.includes(`<meta name="twitter:description" content="${iosMeta}">`), "dsh-ios twitter:description matches the signed meta");
assert(
  iosHtml.includes(
    "dsh-ios（iOS 模拟器与真机流）是给 DeepSeek Harness（DSH）的社区插件：在会话里接入 iOS Simulator，以及经 USB 连接的 iPhone 真机画面，用于构建、运行、按无障碍或 OCR 操作界面，并在侧栏预览。本页只对应目录 id"
  ),
  "dsh-ios lead is the signed copy"
);
assert(
  iosHtml.includes("它把 iOS Simulator，以及经 USB 连接的 iPhone 真机，接到 DeepSeek Harness 会话里：可以启动设备、构建并运行应用，按无障碍身份或 OCR 文字操作界面，并在侧栏实时预览、点按或拖拽。"),
  "dsh-ios body is the signed copy"
);
assert(
  iosHtml.includes("请仅用于个人学习与研究；内容与素材的版权归权利人所有。"),
  "dsh-ios keeps the study/copyright line"
);
assert(!iosHtml.includes("本页是占位"), "dsh-ios has no stub placeholder");
assert(!iosHtml.includes("合入备注"), "dsh-ios omits the writer note");
assert(!iosHtml.includes('data-fact="stars"'), "dsh-ios has no stars tile");
assert(iosHtml.includes("https://github.com/ZSeven-W/dsh-ios"), "dsh-ios repo link");
assert(iosHtml.includes('"softwareVersion": "0.1.0-rc.11"'), "dsh-ios softwareVersion is 0.1.0-rc.11");
assert(!/"softwareVersion": "(?!0\.1\.0-rc\.11")/.test(iosHtml), "dsh-ios has no other softwareVersion");
assert(iosHtml.includes(iosInstall), "dsh-ios install string");
assert(
  iosHtml.split(iosInstall).length - 1 === 7,
  "dsh-ios install string is the signed meta (meta/og/twitter/WebSite) plus code, FAQ, and FAQ JSON-LD"
);
const iosWithoutInstall = iosHtml.split(iosInstall).join("");
assert(!iosWithoutInstall.includes("dsh plugin"), "no second dsh-ios install command");
assert(!iosWithoutInstall.includes("github:"), "no other github: install target on dsh-ios");
assert(!iosWithoutInstall.includes("--profile"), "no second profile on dsh-ios");
assert(!iosHtml.includes("add dsh-ios"), "no short-form add dsh-ios");
assert(!iosHtml.includes("add @zseven-w/dsh-ios"), "no short-form add @zseven-w/dsh-ios");
assert(!iosHtml.includes("@zseven-w/dsh-ios@latest"), "no npm latest spec on dsh-ios");
assert(!iosHtml.includes("--profile desktop"), "no desktop profile on dsh-ios");
assert(!iosHtml.includes("npm install"), "no npm install on dsh-ios");
assert(!iosHtml.includes("npm i "), "no npm i on dsh-ios");
assert(!iosHtml.includes("<title>dsh-ios｜"), "dsh-ios title has no Chinese suffix");
assert(!/<title>[^<]*iOS 模拟器/.test(iosHtml), "iOS 模拟器 is not in the title");
assert(!/<h1[^>]*>[^<]*iOS 模拟器/.test(iosHtml), "iOS 模拟器 is not in the h1");
assert(!/<title>ios<\/title>/.test(iosHtml), "bare ios is not the title");
assert(!iosHtml.includes('<h1 class="page-title">ios</h1>'), "bare ios is not the h1");
assert(!/<title>dsh-ios-simulator<\/title>/.test(iosHtml), "dsh-ios-simulator is not the title");
assert(!iosHtml.includes('<h1 class="page-title">dsh-ios-simulator</h1>'), "dsh-ios-simulator is not the h1");
assert(iosHtml.split(iosPkg).length - 1 === 3, "npm package name appears only in body, FAQ #3, and FAQ JSON-LD");
assert(
  iosHtml.includes("目录包名 <code>@zseven-w/dsh-ios</code> 不是安装命令"),
  "npm package name in the body is marked as not the install command"
);
assert(
  iosHtml.includes("目录包名 @zseven-w/dsh-ios 不是本页的安装命令"),
  "npm package name in FAQ JSON-LD is marked as not the install command"
);
for (const term of ["Kickstartparty", "dsh-xcode", "下载量", "排名", "官方插件", "合入备注"]) {
  assert(!iosHtml.includes(term), `dsh-ios page omits ${term}`);
}
const iosMain = iosHtml.split("<main")[1].split("</main>")[0];
assert(!iosMain.includes('href="/c/'), "dsh-ios main has no /c/ CTA");
assert(!iosMain.includes("官方"), "dsh-ios main does not call the plugin 官方");
const iosLd = JSON.parse(iosHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
const iosFaqLd = iosLd["@graph"].find((node) => node["@type"] === "FAQPage");
const iosAppLd = iosLd["@graph"].find((node) => node["@type"] === "SoftwareApplication");
const iosCrumbLd = iosLd["@graph"].find((node) => node["@type"] === "BreadcrumbList");
assert(iosAppLd.name === "dsh-ios", "SoftwareApplication name is dsh-ios");
assert(iosCrumbLd.itemListElement[1].name === "dsh-ios", "BreadcrumbList name is dsh-ios");
const iosFaqHtml = [...iosHtml.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/gs)].map((m) => ({
  q: m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  a: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
}));
assert(iosFaqLd.mainEntity.length === 4, "dsh-ios FAQPage has 4 items");
assert(iosFaqHtml.length === 4, "dsh-ios HTML FAQ has 4 items");
for (let i = 0; i < 4; i++) {
  assert(iosFaqHtml[i].q === iosFaqLd.mainEntity[i].name, `dsh-ios FAQ ${i + 1} question matches JSON-LD`);
  assert(iosFaqHtml[i].a === iosFaqLd.mainEntity[i].acceptedAnswer.text, `dsh-ios FAQ ${i + 1} answer matches JSON-LD`);
}
assert(iosFaqLd.mainEntity[1].acceptedAnswer.text.startsWith(iosInstall), "dsh-ios FAQPage answer 2 starts with the install command");
assert(sitemapXml.includes("<loc>https://dsplugin.app/plugins/dsh-ios</loc>"), "sitemap lists /plugins/dsh-ios");
assert(
  /<loc>https:\/\/dsplugin\.app\/plugins\/dsh-ios<\/loc>\s*<lastmod>2026-11-10<\/lastmod>/.test(sitemapXml),
  "sitemap lastmod for dsh-ios is 2026-11-10"
);
assert(!sitemapXml.includes("https://dsplugin.app/plugins/ios<"), "sitemap has no bare ios");
assert(!sitemapXml.includes("dsh-ios-simulator"), "sitemap has no dsh-ios-simulator");
assert(!sitemapXml.includes("zseven-w-dsh-ios"), "sitemap has no lowercase owner-hyphen lookalike");
assert(!sitemapXml.includes("ZSeven-W-dsh-ios"), "sitemap has no owner-hyphen lookalike");
assert(!sitemapXml.includes("https://dsplugin.app/c/dsh-ios"), "sitemap has no /c/dsh-ios URL");
assert(!sitemapXml.includes("dsh-xcode"), "sitemap has no dsh-xcode");
assert(!existsSync(join(ROOT, "plugins/ios.html")), "no /plugins/ios page");
assert(!existsSync(join(ROOT, "plugins/dsh-ios-simulator.html")), "no /plugins/dsh-ios-simulator page");
assert(!existsSync(join(ROOT, "plugins/zseven-w-dsh-ios.html")), "no lowercase owner-hyphen page");
assert(!existsSync(join(ROOT, "c/dsh-ios.html")), "no /c/dsh-ios page");

const eacHtml = await readFile(join(ROOT, "plugins/eac-design-world.html"), "utf8");
const eacInstall = "dsh plugin --profile web add github:Ebony-Vinyl/EAC-design-world";
const eacMeta =
  "eac-design-world 是 DeepSeek Harness 的社区插件（EAC design world）：在本地做视频制作与设计，支持多轨剪辑、模板与设计体系、原生预览和真实文件导出。目录 id Ebony-Vinyl/EAC-design-world。安装：dsh plugin --profile web add github:Ebony-Vinyl/EAC-design-world。";
assert(eacHtml.includes("<title>eac-design-world</title>"), "eac-design-world title is exactly eac-design-world");
assert(eacHtml.includes('<h1 class="page-title">eac-design-world</h1>'), "eac-design-world h1 is exactly eac-design-world");
assert(
  eacHtml.includes('<meta property="og:title" content="eac-design-world">'),
  "eac-design-world og:title is exactly eac-design-world"
);
assert(
  eacHtml.includes('<meta name="twitter:title" content="eac-design-world">'),
  "eac-design-world twitter:title is exactly eac-design-world"
);
assert(
  eacHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/eac-design-world">'),
  "eac-design-world canonical is lowercase"
);
assert(!/noindex/i.test(eacHtml), "eac-design-world has no noindex");
assert(eacHtml.includes('data-plugin-id="Ebony-Vinyl/EAC-design-world"'), "eac-design-world pins catalog id");
assert(eacHtml.includes(`<meta name="description" content="${eacMeta}">`), "eac-design-world meta description is the signed suggestion");
assert(eacHtml.includes(`<meta property="og:description" content="${eacMeta}">`), "eac-design-world og:description matches the signed meta");
assert(
  eacHtml.includes(`<meta name="twitter:description" content="${eacMeta}">`),
  "eac-design-world twitter:description matches the signed meta"
);
assert(
  eacHtml.includes(
    "eac-design-world（EAC design world）是给 DeepSeek Harness（DSH）的社区插件：在本地完成视频制作与设计，支持多轨剪辑、模板与设计体系、原生预览和真实文件导出。本页只对应目录 id"
  ),
  "eac-design-world lead is the signed copy"
);
assert(
  eacHtml.includes("它把本地视频制作与设计带进 DeepSeek Harness：可在多轨时间线上编排片段，选用模板与设计体系，在侧栏做原生预览，并把成片、字幕或设计源文件导出到本地。"),
  "eac-design-world body is the signed copy"
);
assert(
  eacHtml.includes("请仅用于个人学习与研究，并遵守素材、模板与第三方服务的许可与条款；内容与素材的版权归权利人所有。"),
  "eac-design-world keeps the study/license/copyright line"
);
assert(
  eacHtml.includes("仓库 README 里还有发布包与其它安装渠道，那些都不是本页的安装命令"),
  "eac-design-world mentions other install channels only as not this page's command"
);
assert(!eacHtml.includes("本页是占位"), "eac-design-world has no stub placeholder");
assert(!eacHtml.includes("合入备注"), "eac-design-world omits the writer note");
assert(!eacHtml.includes('data-fact="stars"'), "eac-design-world has no stars tile");
assert(eacHtml.includes("https://github.com/Ebony-Vinyl/EAC-design-world"), "eac-design-world repo link");
assert(eacHtml.includes('"softwareVersion": "0.6.1"'), "eac-design-world softwareVersion is 0.6.1");
assert(!/"softwareVersion": "(?!0\.6\.1")/.test(eacHtml), "eac-design-world has no other softwareVersion");
assert(eacHtml.includes(eacInstall), "eac-design-world install string");
assert(
  eacHtml.split(eacInstall).length - 1 === 7,
  "eac-design-world install string is the signed meta (meta/og/twitter/WebSite) plus code, FAQ, and FAQ JSON-LD"
);
const eacWithoutInstall = eacHtml.split(eacInstall).join("");
assert(!eacWithoutInstall.includes("dsh plugin"), "no second eac-design-world install command");
assert(!eacWithoutInstall.includes("github:"), "no other github: install target on eac-design-world");
assert(!eacWithoutInstall.includes("--profile"), "no second profile on eac-design-world");
assert(!eacHtml.includes("add eac-design-world"), "no short-form add eac-design-world");
assert(!eacHtml.includes("--profile desktop"), "no desktop profile on eac-design-world");
assert(!eacHtml.includes("npm install"), "no npm install on eac-design-world");
assert(!eacHtml.includes("npm i "), "no npm i on eac-design-world");
assert(!eacHtml.includes("install-harness.mjs"), "no install-harness.mjs on eac-design-world");
assert(!eacHtml.includes(".tgz"), "no tgz install on eac-design-world");
assert(!eacHtml.includes(".zip"), "no zip install on eac-design-world");
assert(!eacHtml.includes("EAC-Pack"), "EAC-Pack is not an install command or subject");
assert(!eacHtml.includes("eac-pack"), "eac-pack is not on the page");
assert(!eacHtml.includes("<title>eac-design-world｜"), "eac-design-world title has no Chinese suffix");
assert(!/<title>EAC-design-world<\/title>/.test(eacHtml), "EAC-design-world is not the title");
assert(!eacHtml.includes('<h1 class="page-title">EAC-design-world</h1>'), "EAC-design-world is not the h1");
assert(!/<title>eac-design<\/title>/.test(eacHtml), "bare eac-design is not the title");
assert(!eacHtml.includes('<h1 class="page-title">eac-design</h1>'), "bare eac-design is not the h1");
assert(!/<title>eac-designworld<\/title>/.test(eacHtml), "eac-designworld is not the title");
assert(!eacHtml.includes('<h1 class="page-title">eac-designworld</h1>'), "eac-designworld is not the h1");
for (const term of ["自媒体", "短剧", "画布", "节点画布", "无限画布", "下载量", "排名", "官方插件", "合入备注"]) {
  assert(!eacHtml.includes(term), `eac-design-world page omits ${term}`);
}
const eacMain = eacHtml.split("<main")[1].split("</main>")[0];
assert(!eacMain.includes('href="/c/'), "eac-design-world main has no /c/ CTA");
assert(!eacMain.includes("官方"), "eac-design-world main does not call the plugin 官方");
const eacLd = JSON.parse(eacHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
const eacFaqLd = eacLd["@graph"].find((node) => node["@type"] === "FAQPage");
const eacAppLd = eacLd["@graph"].find((node) => node["@type"] === "SoftwareApplication");
const eacCrumbLd = eacLd["@graph"].find((node) => node["@type"] === "BreadcrumbList");
assert(eacAppLd.name === "eac-design-world", "SoftwareApplication name is eac-design-world");
assert(eacCrumbLd.itemListElement[1].name === "eac-design-world", "BreadcrumbList name is eac-design-world");
const eacFaqHtml = [...eacHtml.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/gs)].map((m) => ({
  q: m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  a: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
}));
assert(eacFaqLd.mainEntity.length === 4, "eac-design-world FAQPage has 4 items");
assert(eacFaqHtml.length === 4, "eac-design-world HTML FAQ has 4 items");
for (let i = 0; i < 4; i++) {
  assert(eacFaqHtml[i].q === eacFaqLd.mainEntity[i].name, `eac-design-world FAQ ${i + 1} question matches JSON-LD`);
  assert(
    eacFaqHtml[i].a === eacFaqLd.mainEntity[i].acceptedAnswer.text,
    `eac-design-world FAQ ${i + 1} answer matches JSON-LD`
  );
}
assert(
  eacFaqLd.mainEntity[1].acceptedAnswer.text.startsWith(eacInstall),
  "eac-design-world FAQPage answer 2 starts with the install command"
);
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/eac-design-world</loc>"),
  "sitemap lists /plugins/eac-design-world"
);
assert(
  /<loc>https:\/\/dsplugin\.app\/plugins\/eac-design-world<\/loc>\s*<lastmod>2026-11-10<\/lastmod>/.test(sitemapXml),
  "sitemap lastmod for eac-design-world is 2026-11-10"
);
assert(!sitemapXml.includes("https://dsplugin.app/plugins/EAC-design-world"), "sitemap has no uppercase EAC-design-world");
assert(!sitemapXml.includes("https://dsplugin.app/plugins/EAC-Design-World"), "sitemap has no title-case EAC path");
assert(!sitemapXml.includes("https://dsplugin.app/plugins/eac-design<"), "sitemap has no bare eac-design");
assert(!sitemapXml.includes("eac-designworld"), "sitemap has no eac-designworld");
assert(!sitemapXml.includes("EAC-Pack"), "sitemap has no EAC-Pack");
assert(!sitemapXml.includes("eac-pack"), "sitemap has no eac-pack");
assert(!sitemapXml.includes("https://dsplugin.app/c/eac-design-world"), "sitemap has no /c/eac-design-world URL");
assert(!existsSync(join(ROOT, "plugins/eac-design.html")), "no /plugins/eac-design page");
assert(!existsSync(join(ROOT, "plugins/eac-designworld.html")), "no /plugins/eac-designworld page");
assert(!existsSync(join(ROOT, "plugins/EAC-Pack.html")), "no /plugins/EAC-Pack page");
assert(!existsSync(join(ROOT, "plugins/eac-pack.html")), "no /plugins/eac-pack page");
assert(!existsSync(join(ROOT, "c/eac-design-world.html")), "no /c/eac-design-world page");

const wallHtml = await readFile(join(ROOT, "plugins/dsh-wallpaper-engine.html"), "utf8");
const wallInstall = "dsh plugin --profile web add github:elysia395/dsh-wallpaper-engine";
const wallMeta =
  "dsh-wallpaper-engine 是 DeepSeek Harness 的社区插件：把本机 Wallpaper Engine 里的 Scene、Web 或视频内容铺到 DSH 网页会话界面背后使用。目录 id elysia395/dsh-wallpaper-engine。安装：dsh plugin --profile web add github:elysia395/dsh-wallpaper-engine。";
assert(wallHtml.includes("<title>dsh-wallpaper-engine</title>"), "dsh-wallpaper-engine title is exactly dsh-wallpaper-engine");
assert(wallHtml.includes('<h1 class="page-title">dsh-wallpaper-engine</h1>'), "dsh-wallpaper-engine h1 is exactly dsh-wallpaper-engine");
assert(
  wallHtml.includes('<meta property="og:title" content="dsh-wallpaper-engine">'),
  "dsh-wallpaper-engine og:title is exactly dsh-wallpaper-engine"
);
assert(
  wallHtml.includes('<meta name="twitter:title" content="dsh-wallpaper-engine">'),
  "dsh-wallpaper-engine twitter:title is exactly dsh-wallpaper-engine"
);
assert(
  wallHtml.includes('<link rel="canonical" href="https://dsplugin.app/plugins/dsh-wallpaper-engine">'),
  "dsh-wallpaper-engine canonical is self"
);
assert(!/noindex/i.test(wallHtml), "dsh-wallpaper-engine has no noindex");
assert(wallHtml.includes('data-plugin-id="elysia395/dsh-wallpaper-engine"'), "dsh-wallpaper-engine pins catalog id");
assert(wallHtml.includes(`<meta name="description" content="${wallMeta}">`), "dsh-wallpaper-engine meta description is the signed suggestion");
assert(wallHtml.includes(`<meta property="og:description" content="${wallMeta}">`), "dsh-wallpaper-engine og:description matches the signed meta");
assert(
  wallHtml.includes(`<meta name="twitter:description" content="${wallMeta}">`),
  "dsh-wallpaper-engine twitter:description matches the signed meta"
);
assert(
  wallHtml.includes(
    "dsh-wallpaper-engine（Wallpaper Engine 背景接入）是给 DeepSeek Harness（DSH）的社区插件：把本机 Wallpaper Engine 里的 Scene、Web 或视频内容，铺到 DSH 网页会话界面背后使用。使用前需要本机已有 Wallpaper Engine 的内容库。本页只对应目录 id"
  ),
  "dsh-wallpaper-engine lead is the signed copy"
);
assert(
  wallHtml.includes("它读取本机已有的 Wallpaper Engine 内容库，把其中的 Scene、Web 或视频铺到 DeepSeek Harness 网页会话界面背后，并可在设置里筛选、轮播或调整显示。"),
  "dsh-wallpaper-engine body is the signed copy"
);
assert(
  wallHtml.includes("请仅用于个人学习与研究；内容与素材的版权归权利人所有。"),
  "dsh-wallpaper-engine keeps the study/copyright line"
);
assert(
  wallHtml.includes("仓库 README 里还有短式包名、其它 profile 与源码安装方式，那些都不是本页的安装命令"),
  "dsh-wallpaper-engine mentions other install channels only as not this page's command"
);
assert(!wallHtml.includes("本页是占位"), "dsh-wallpaper-engine has no stub placeholder");
assert(!wallHtml.includes("合入备注"), "dsh-wallpaper-engine omits the writer note");
assert(!wallHtml.includes('data-fact="stars"'), "dsh-wallpaper-engine has no stars tile");
assert(wallHtml.includes("https://github.com/elysia395/dsh-wallpaper-engine"), "dsh-wallpaper-engine repo link");
assert(wallHtml.includes('"softwareVersion": "1.4.2"'), "dsh-wallpaper-engine softwareVersion is 1.4.2");
assert(!/"softwareVersion": "(?!1\.4\.2")/.test(wallHtml), "dsh-wallpaper-engine has no other softwareVersion");
assert(wallHtml.includes(wallInstall), "dsh-wallpaper-engine install string");
assert(
  wallHtml.split(wallInstall).length - 1 === 7,
  "dsh-wallpaper-engine install string is the signed meta (meta/og/twitter/WebSite) plus code, FAQ, and FAQ JSON-LD"
);
const wallWithoutInstall = wallHtml.split(wallInstall).join("");
assert(!wallWithoutInstall.includes("dsh plugin"), "no second dsh-wallpaper-engine install command");
assert(!wallWithoutInstall.includes("github:"), "no other github: install target on dsh-wallpaper-engine");
assert(!wallWithoutInstall.includes("--profile"), "no second profile on dsh-wallpaper-engine");
assert(!wallHtml.includes("add dsh-wallpaper-engine"), "no short-form add dsh-wallpaper-engine");
assert(!wallHtml.includes("add dsh-plugin-wallpaper-engine"), "no short-form add dsh-plugin-wallpaper-engine");
assert(!wallHtml.includes("dsh-plugin-wallpaper-engine"), "catalog package name dsh-plugin-wallpaper-engine is not on the page");
assert(!wallHtml.includes("@dsh-use/wallpaper-engine"), "npm scope @dsh-use/wallpaper-engine is not on the page");
assert(!wallHtml.includes("dsh-use-wallpaper"), "dsh-use-wallpaper is not on the page");
assert(!wallHtml.includes("--profile desktop"), "no desktop profile on dsh-wallpaper-engine");
assert(!wallHtml.includes("npm install"), "no npm install on dsh-wallpaper-engine");
assert(!wallHtml.includes("npm i "), "no npm i on dsh-wallpaper-engine");
assert(!wallHtml.includes("install-source.mjs"), "no install-source.mjs on dsh-wallpaper-engine");
assert(!wallHtml.includes("<title>dsh-wallpaper-engine｜"), "dsh-wallpaper-engine title has no Chinese suffix");
assert(!/<title>[^<]*背景接入/.test(wallHtml), "背景接入 is not in the title");
assert(!/<h1[^>]*>[^<]*背景接入/.test(wallHtml), "背景接入 is not in the h1");
assert(!/<title>[^<]*Wallpaper Engine/.test(wallHtml), "Wallpaper Engine is not in the title");
assert(!/<h1[^>]*>[^<]*Wallpaper Engine/.test(wallHtml), "Wallpaper Engine is not in the h1");
assert(!/<title>wallpaper-engine<\/title>/.test(wallHtml), "bare wallpaper-engine is not the title");
assert(!wallHtml.includes('<h1 class="page-title">wallpaper-engine</h1>'), "bare wallpaper-engine is not the h1");
assert(!/<title>dsh-plugin-wallpaper-engine<\/title>/.test(wallHtml), "dsh-plugin-wallpaper-engine is not the title");
assert(!wallHtml.includes('<h1 class="page-title">dsh-plugin-wallpaper-engine</h1>'), "dsh-plugin-wallpaper-engine is not the h1");
for (const term of [
  "壁纸",
  "皮肤",
  "换肤",
  "液态玻璃",
  "开机动画",
  "Magpie",
  "magpie",
  "DPH-1121",
  "drmi5446",
  "sakuraaa667",
  "yu502950715yang",
  "下载量",
  "排名",
  "赞赏",
  "打赏",
  "官方插件",
  "合入备注",
]) {
  assert(!wallHtml.includes(term), `dsh-wallpaper-engine page omits ${term}`);
}
const wallMain = wallHtml.split("<main")[1].split("</main>")[0];
assert(!wallMain.includes('href="/c/'), "dsh-wallpaper-engine main has no /c/ CTA");
assert(!wallMain.includes("官方"), "dsh-wallpaper-engine main does not call the plugin 官方");
const wallLd = JSON.parse(wallHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)[1]);
const wallFaqLd = wallLd["@graph"].find((node) => node["@type"] === "FAQPage");
const wallAppLd = wallLd["@graph"].find((node) => node["@type"] === "SoftwareApplication");
const wallCrumbLd = wallLd["@graph"].find((node) => node["@type"] === "BreadcrumbList");
const wallSiteLd = wallLd["@graph"].find((node) => node["@type"] === "WebSite");
assert(wallAppLd.name === "dsh-wallpaper-engine", "SoftwareApplication name is dsh-wallpaper-engine");
assert(wallAppLd.softwareVersion === "1.4.2", "SoftwareApplication softwareVersion is 1.4.2");
assert(wallCrumbLd.itemListElement[1].name === "dsh-wallpaper-engine", "BreadcrumbList name is dsh-wallpaper-engine");
assert(wallSiteLd.description === wallMeta, "WebSite JSON-LD description is the signed meta");
const wallFaqHtml = [...wallHtml.matchAll(/<div><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/gs)].map((m) => ({
  q: m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  a: m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
}));
assert(wallFaqLd.mainEntity.length === 4, "dsh-wallpaper-engine FAQPage has 4 items");
assert(wallFaqHtml.length === 4, "dsh-wallpaper-engine HTML FAQ has 4 items");
for (let i = 0; i < 4; i++) {
  assert(wallFaqHtml[i].q === wallFaqLd.mainEntity[i].name, `dsh-wallpaper-engine FAQ ${i + 1} question matches JSON-LD`);
  assert(
    wallFaqHtml[i].a === wallFaqLd.mainEntity[i].acceptedAnswer.text,
    `dsh-wallpaper-engine FAQ ${i + 1} answer matches JSON-LD`
  );
}
assert(
  wallFaqLd.mainEntity[1].acceptedAnswer.text.startsWith(wallInstall),
  "dsh-wallpaper-engine FAQPage answer 2 starts with the install command"
);
assert(
  sitemapXml.includes("<loc>https://dsplugin.app/plugins/dsh-wallpaper-engine</loc>"),
  "sitemap lists /plugins/dsh-wallpaper-engine"
);
assert(
  /<loc>https:\/\/dsplugin\.app\/plugins\/dsh-wallpaper-engine<\/loc>\s*<lastmod>2026-11-11<\/lastmod>/.test(sitemapXml),
  "sitemap lastmod for dsh-wallpaper-engine is 2026-11-11"
);
assert(!sitemapXml.includes("dsh-plugin-wallpaper-engine"), "sitemap has no dsh-plugin-wallpaper-engine");
assert(!sitemapXml.includes("https://dsplugin.app/plugins/wallpaper-engine"), "sitemap has no bare wallpaper-engine");
assert(!sitemapXml.includes("https://dsplugin.app/c/dsh-wallpaper-engine"), "sitemap has no /c/dsh-wallpaper-engine URL");
assert(!sitemapXml.includes("https://dsplugin.app/c/wallpaper-engine"), "sitemap has no /c/wallpaper-engine URL");
assert(!sitemapXml.includes("elysia395-dsh-wallpaper-engine"), "sitemap has no owner-hyphen lookalike");
assert(!sitemapXml.includes("DSH-wallpaper-engine"), "sitemap has no uppercase DSH-wallpaper-engine");
assert(!sitemapXml.includes("dsh-Wallpaper-Engine"), "sitemap has no mixed-case dsh-Wallpaper-Engine");
assert(!existsSync(join(ROOT, "plugins/dsh-plugin-wallpaper-engine.html")), "no /plugins/dsh-plugin-wallpaper-engine page");
assert(!existsSync(join(ROOT, "plugins/wallpaper-engine.html")), "no /plugins/wallpaper-engine page");
assert(!existsSync(join(ROOT, "plugins/elysia395-dsh-wallpaper-engine.html")), "no owner-hyphen wallpaper page");
assert(!existsSync(join(ROOT, "c/dsh-wallpaper-engine.html")), "no /c/dsh-wallpaper-engine page");
assert(!existsSync(join(ROOT, "c/dsh-plugin-wallpaper-engine.html")), "no /c/dsh-plugin-wallpaper-engine page");
assert(!existsSync(join(ROOT, "c/wallpaper-engine.html")), "no /c/wallpaper-engine page");

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
  assert(envBytes < 20000, `sharded envelope stays a manifest (${envBytes} bytes)`);
  assert(rebuilt.length === prepared.shardInfo.count, "shard plugin count matches");
  assert(rebuilt[0].id === prepared.catalogFirst, "shards keep catalog order at the start");
  assert(rebuilt[rebuilt.length - 1].id === prepared.catalogLast, "shards keep catalog order at the end");
  assert(envelope.list && envelope.list.count === rebuilt.length, "envelope list.count is the plugin count");
  assert(envelope.list.pageSize === 60, "envelope list.pageSize is 60");
  assert(envelope.list.total === rebuilt.length, "envelope list.total matches the catalog");
  assert(envelope.list.totalPages === Math.ceil(rebuilt.length / 60), "envelope list.totalPages");
  assert(prepared.listPages === envelope.list.totalPages, "upload has one default page per page");
  let specStars = 0;
  let specValidated = 0;
  const specOwners = {};
  const specCounts = {};
  const specLangs = {};
  const specInstalls = [];
  for (const plugin of rebuilt) {
    specStars += plugin.stars || 0;
    if (plugin.owner) specOwners[plugin.owner] = true;
    const manifest = (plugin.verification && plugin.verification.manifest) || "not_checked";
    if (manifest === "shape_validated") specValidated += 1;
    specCounts[plugin.category] = (specCounts[plugin.category] || 0) + 1;
    if (plugin.language) specLangs[plugin.language] = true;
    if (plugin.install && specInstalls.length < 12) specInstalls.push(plugin.install);
  }
  assert(envelope.list.stars === specStars, "list.stars matches fillStats");
  assert(envelope.list.authors === Object.keys(specOwners).length, "list.authors matches fillStats");
  assert(envelope.list.validated === specValidated, "list.validated matches fillStats");
  assert(
    JSON.stringify(envelope.list.installSamples) === JSON.stringify(specInstalls),
    "install samples are the first 12 catalog-order commands"
  );
  const specLanguages = Object.keys(specLangs).sort((a, b) => a.localeCompare(b));
  assert(JSON.stringify(envelope.list.languages) === JSON.stringify(specLanguages), "list.languages match buildLanguages");
  for (const key of new Set([...Object.keys(specCounts), ...Object.keys(envelope.list.categoryCounts)])) {
    assert(envelope.list.categoryCounts[key] === specCounts[key], `category count ${key}`);
  }
  const sortNow = Date.parse(envelope.list.sortedAt);
  function specScore(plugin) {
    let s = (plugin.stars || 0) * 2 + (plugin.forks || 0) * 0.2;
    const manifest = (plugin.verification && plugin.verification.manifest) || "not_checked";
    if (manifest === "shape_validated") s += 180;
    if (plugin.source === "curated") s += 40;
    const pushed = Date.parse(plugin.pushedAt || "") || 0;
    s += Math.max(0, (pushed - sortNow + 1000 * 60 * 60 * 24 * 90) / (1000 * 60 * 60 * 24));
    return s;
  }
  const specSorted = rebuilt.slice().sort((a, b) => specScore(b) - specScore(a));
  const gotIds = [];
  let firstPage = null;
  for (let page = 1; page <= envelope.list.totalPages; page++) {
    const name = `list-default-${String(page).padStart(3, "0")}.json`;
    const body = JSON.parse(await readFile(join(outDir, "data", name), "utf8"));
    if (page === 1) firstPage = body;
    assert(body.page === page, `${name} page field`);
    assert(body.pageSize === 60, `${name} pageSize`);
    assert(body.sort === "relevance", `${name} sort`);
    assert(body.total === rebuilt.length, `${name} total`);
    assert(body.totalPages === envelope.list.totalPages, `${name} totalPages`);
    assert(body.plugins.length > 0 && body.plugins.length <= 60, `${name} has at most 60 plugins`);
    if (page < envelope.list.totalPages) assert(body.plugins.length === 60, `${name} is a full page`);
    gotIds.push(...body.plugins.map((plugin) => plugin.id));
  }
  assert(gotIds.length === specSorted.length, "default pages cover every plugin once");
  assert(
    gotIds.join("\n") === specSorted.map((plugin) => plugin.id).join("\n"),
    "default pages match empty-query relevance order"
  );
  const firstLite = rebuilt.find((plugin) => plugin.id === firstPage.plugins[0].id);
  assert(
    firstLite && firstLite.name === firstPage.plugins[0].name && firstLite.stars === firstPage.plugins[0].stars,
    "page 1 keeps the lite plugin fields the list renders"
  );
  assert(!existsSync(join(outDir, "data/plugins-index.json")), "this round does not upload a search index");
  const ops = rebuilt.find((p) => p.id === "T-Auto/dsh-ops");
  assert(ops && ops.name === "dsh-ops", "sharded lite still contains T-Auto/dsh-ops");
  assert(prepared.largest.bytes < PAGES_FILE_LIMIT, "largest upload file is under 25 MiB");
  const landingStat = await stat(join(outDir, "plugins/dsh-ops.html"));
  assert(landingStat.isFile(), "dsh-ops landing is in the upload");
  const landing = await readFile(join(outDir, "plugins/dsh-ops.html"), "utf8");
  assert(landing.includes('href="https://dsplugin.app/plugins/dsh-ops"'), "uploaded landing keeps canonical");
  const harnmemLanding = await readFile(join(outDir, "plugins/dsh-harnmem.html"), "utf8");
  assert(
    harnmemLanding.includes('href="https://dsplugin.app/plugins/dsh-harnmem"'),
    "uploaded dsh-harnmem landing keeps canonical"
  );
  const hongguoLanding = await readFile(join(outDir, "plugins/dsh-hongguo.html"), "utf8");
  assert(
    hongguoLanding.includes('href="https://dsplugin.app/plugins/dsh-hongguo"'),
    "uploaded dsh-hongguo landing keeps canonical"
  );
  assert(!hongguoLanding.includes("本页是占位"), "uploaded dsh-hongguo landing is not a stub");
  const mediaDeskLanding = await readFile(join(outDir, "plugins/dsh-media-desk.html"), "utf8");
  assert(
    mediaDeskLanding.includes('href="https://dsplugin.app/plugins/dsh-media-desk"'),
    "uploaded dsh-media-desk landing keeps canonical"
  );
  assert(!mediaDeskLanding.includes("本页是占位"), "uploaded dsh-media-desk landing is not a stub");
  assert(mediaDeskLanding.includes(mediaDeskInstall), "uploaded dsh-media-desk keeps the install command");
  const infiniteCanvasLanding = await readFile(join(outDir, "plugins/dsh-infinite_canvas.html"), "utf8");
  assert(
    infiniteCanvasLanding.includes('href="https://dsplugin.app/plugins/dsh-infinite_canvas"'),
    "uploaded dsh-infinite_canvas landing keeps canonical"
  );
  assert(!infiniteCanvasLanding.includes("本页是占位"), "uploaded dsh-infinite_canvas landing is not a stub");
  assert(infiniteCanvasLanding.includes(infiniteCanvasInstall), "uploaded dsh-infinite_canvas keeps the install command");
  const agenteroLanding = await readFile(join(outDir, "plugins/agentero-dsh-plugin.html"), "utf8");
  assert(
    agenteroLanding.includes('href="https://dsplugin.app/plugins/agentero-dsh-plugin"'),
    "uploaded agentero-dsh-plugin landing keeps canonical"
  );
  assert(!agenteroLanding.includes("本页是占位"), "uploaded agentero-dsh-plugin landing is not a stub");
  assert(agenteroLanding.includes(agenteroInstall), "uploaded agentero-dsh-plugin keeps the install command");
  const providersLanding = await readFile(join(outDir, "plugins/dsh-providers-hub.html"), "utf8");
  assert(
    providersLanding.includes('href="https://dsplugin.app/plugins/dsh-providers-hub"'),
    "uploaded dsh-providers-hub landing keeps canonical"
  );
  assert(!providersLanding.includes("本页是占位"), "uploaded dsh-providers-hub landing is not a stub");
  assert(providersLanding.includes(providersInstall), "uploaded dsh-providers-hub keeps the install command");
  const iosLanding = await readFile(join(outDir, "plugins/dsh-ios.html"), "utf8");
  assert(iosLanding.includes('href="https://dsplugin.app/plugins/dsh-ios"'), "uploaded dsh-ios landing keeps canonical");
  assert(!iosLanding.includes("本页是占位"), "uploaded dsh-ios landing is not a stub");
  assert(iosLanding.includes(iosInstall), "uploaded dsh-ios keeps the install command");
  const eacLanding = await readFile(join(outDir, "plugins/eac-design-world.html"), "utf8");
  assert(
    eacLanding.includes('href="https://dsplugin.app/plugins/eac-design-world"'),
    "uploaded eac-design-world landing keeps canonical"
  );
  assert(!eacLanding.includes("本页是占位"), "uploaded eac-design-world landing is not a stub");
  assert(eacLanding.includes(eacInstall), "uploaded eac-design-world keeps the install command");
  const wallLanding = await readFile(join(outDir, "plugins/dsh-wallpaper-engine.html"), "utf8");
  assert(
    wallLanding.includes('href="https://dsplugin.app/plugins/dsh-wallpaper-engine"'),
    "uploaded dsh-wallpaper-engine landing keeps canonical"
  );
  assert(!wallLanding.includes("本页是占位"), "uploaded dsh-wallpaper-engine landing is not a stub");
  assert(wallLanding.includes(wallInstall), "uploaded dsh-wallpaper-engine keeps the install command");
  assert(!existsSync(join(outDir, "data/plugins.json")), "upload still omits data/plugins.json");

  const whole = await preparePagesDeploy({
    root: ROOT,
    outDir: wholeDir,
    shardTarget: PAGES_FILE_LIMIT - 1,
  });
  assert(whole.shardInfo.sharded === false, "lite under the override target stays one file");
  const wholeLite = JSON.parse(await readFile(join(wholeDir, "data/plugins-lite.json"), "utf8"));
  assert(Array.isArray(wholeLite.plugins) && wholeLite.plugins.length === rebuilt.length, "unsharded lite keeps plugins");
  assert(wholeLite.list && wholeLite.list.count === wholeLite.plugins.length, "unsharded lite keeps list meta");
  assert(existsSync(join(wholeDir, "data/list-default-001.json")), "unsharded upload still writes default pages");
  assert(existsSync(join(wholeDir, "data/plugins-lite-000.json")) === false, "unsharded upload does not invent shard 0");
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

const envBrowser = browserContext({
  "/data/plugins-lite.json": {
    stats: { published: 2 },
    categories: { tools: { zh: "工具", en: "Tools" } },
    shards: ["plugins-lite-000.json", "plugins-lite-001.json"],
    list: {
      count: 2,
      stars: 9,
      authors: 2,
      validated: 1,
      categoryCounts: { tools: 2 },
      languages: ["Go"],
      pageSize: 60,
      total: 2,
      totalPages: 1,
    },
  },
  "/data/plugins-lite-000.json": catalogFiles["/data/plugins-lite-000.json"],
  "/data/plugins-lite-001.json": catalogFiles["/data/plugins-lite-001.json"],
});
vm.runInContext(dataCode, envBrowser.sandbox);
assert(envBrowser.sandbox.window.DSH.plugins().length === 0, "plugins() is empty before any catalog load");
const envOnly = await envBrowser.sandbox.window.DSH.loadLiteEnvelope();
assert(envOnly.list.count === 2, "envelope exposes list meta");
assert(envBrowser.sandbox.window.DSH.categories().tools.zh === "工具", "categories are readable from the envelope");
assert(envBrowser.sandbox.window.DSH.plugins().length === 0, "envelope load does not expose shard plugins");
assert(!envBrowser.counts["/data/plugins-lite-000.json"], "envelope load does not fetch shards");
const joinedAfterEnv = await envBrowser.sandbox.window.DSH.loadCatalog();
assert(joinedAfterEnv.plugins.length === 2, "catalog after the envelope still joins shards");
assert(envBrowser.counts["/data/plugins-lite.json"] === 1, "catalog reuses the envelope response");
assert(envBrowser.counts["/data/plugins-lite-000.json"] === 1, "catalog fetches shards only when asked");

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

const rankCode = await readFile(join(ROOT, "js/list-rank.js"), "utf8");
const listCode = await readFile(join(ROOT, "js/list.js"), "utf8");

function shardUrls(counts) {
  return Object.keys(counts).filter((url) => /\/data\/plugins-lite-\d+\.json$/.test(url));
}

function bootHome(files, search) {
  const counts = {};
  const allEls = [];
  function hasClass(el, name) {
    return String(el.className || "").split(/\s+/).filter(Boolean).includes(name);
  }
  function matches(el, sel) {
    if (!el || !el.attrs) return false;
    if (sel === ".chip[data-cat]") return hasClass(el, "chip") && el.attrs["data-cat"] != null;
    if (sel === '[data-cat="all"]') return el.attrs["data-cat"] === "all";
    if (sel === ".chip-count") return hasClass(el, "chip-count");
    return false;
  }
  function descendants(el) {
    const out = [];
    for (const child of el.children || []) {
      out.push(child);
      out.push(...descendants(child));
    }
    return out;
  }
  function queryAll(root, sel) {
    const scope = root == null ? allEls : descendants(root);
    return scope.filter((el) => matches(el, sel));
  }
  function makeEl(tag) {
    const el = {
      tag,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      className: "",
      type: "",
      attrs: {},
      children: [],
      listeners: {},
    };
    el.classList = {
      toggle(name, on) {
        const parts = new Set(String(el.className || "").split(/\s+/).filter(Boolean));
        if (on) parts.add(name);
        else parts.delete(name);
        el.className = [...parts].join(" ");
      },
    };
    el.setAttribute = (key, value) => {
      el.attrs[key] = String(value);
    };
    el.getAttribute = (key) => (el.attrs[key] == null ? null : el.attrs[key]);
    el.addEventListener = (type, fn) => {
      (el.listeners[type] ||= []).push(fn);
    };
    el.appendChild = (child) => {
      el.children.push(child);
      return child;
    };
    el.querySelector = (sel) => queryAll(el, sel)[0] || null;
    el.querySelectorAll = (sel) => queryAll(el, sel);
    allEls.push(el);
    return el;
  }
  const byId = {};
  function register(id, tag) {
    const el = makeEl(tag || "div");
    byId[id] = el;
    return el;
  }
  const chips = register("chips");
  const allBtn = makeEl("button");
  allBtn.className = "chip on";
  allBtn.attrs["data-cat"] = "all";
  const allCount = makeEl("span");
  allCount.className = "chip-count";
  allBtn.appendChild(allCount);
  chips.appendChild(allBtn);
  register("list");
  register("list-note");
  const moreWrap = register("load-more-wrap");
  moreWrap.hidden = true;
  register("load-more", "button");
  register("q", "input");
  register("language", "select");
  register("source", "select");
  register("manifest", "select");
  register("sort", "select");
  register("st-count", "b");
  register("st-stars", "b");
  register("st-author", "b");
  register("st-auto", "b");
  register("typer", "span");
  const document = {
    listeners: {},
    getElementById(id) {
      return byId[id] || null;
    },
    createElement(tag) {
      return makeEl(tag);
    },
    querySelectorAll(sel) {
      return queryAll(null, sel);
    },
    querySelector(sel) {
      return queryAll(null, sel)[0] || null;
    },
    addEventListener(type, fn) {
      (document.listeners[type] ||= []).push(fn);
    },
    dispatchEvent(ev) {
      (document.listeners[ev.type] || []).forEach((fn) => fn(ev));
      return true;
    },
  };
  const sandbox = {
    console,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    CustomEvent,
    location: { search: search || "", pathname: "/", hash: "" },
    history: { replaceState() {} },
    document,
    fetch(url) {
      const key = String(url);
      counts[key] = (counts[key] || 0) + 1;
      const body = files[key];
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
  sandbox.window = sandbox;
  sandbox.DSHCommon = {
    countUp(el, n) {
      if (el) el.textContent = sandbox.DSH.formatNum(n);
    },
    bindSearchHotkey() {},
    starSvg() {
      return "";
    },
    forkSvg() {
      return "";
    },
    prefersReducedMotion() {
      return true;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(rankCode, sandbox, { filename: "list-rank.js" });
  vm.runInContext(dataCode, sandbox, { filename: "data.js" });
  vm.runInContext(listCode, sandbox, { filename: "list.js" });
  return { sandbox, counts, byId };
}

function homeFiles() {
  return {
    "/data/plugins-lite.json": {
      categories: { tools: { zh: "工具", en: "Tools" } },
      shards: ["plugins-lite-000.json"],
      list: {
        count: 40,
        stars: 12345,
        authors: 8,
        validated: 3,
        categoryCounts: { tools: 6 },
        languages: ["Go"],
        pageSize: 60,
        total: 40,
        totalPages: 1,
        installSamples: ["dsh plugin --profile web add github:a/alpha"],
      },
    },
    "/data/list-default-001.json": {
      page: 1,
      pageSize: 60,
      total: 2,
      totalPages: 2,
      sort: "relevance",
      plugins: [{
        id: "a/alpha",
        name: "Alpha",
        owner: "a",
        url: "https://github.com/a/alpha",
        category: "tools",
        stars: 3,
        source: "curated",
        language: "Go",
        verification: { manifest: "shape_validated" },
      }],
    },
    "/data/list-default-002.json": {
      page: 2,
      pageSize: 60,
      total: 2,
      totalPages: 2,
      sort: "relevance",
      plugins: [{
        id: "b/beta",
        name: "Beta",
        owner: "b",
        url: "https://github.com/b/beta",
        category: "tools",
        stars: 2,
        source: "discovered",
        language: "Go",
      }],
    },
    "/data/plugins-lite-000.json": {
      plugins: [{
        id: "s/from",
        name: "From Shard",
        owner: "s",
        url: "https://github.com/s/from",
        category: "tools",
        stars: 1,
        source: "discovered",
        language: "Go",
      }],
    },
  };
}

async function flushHome() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

try {
  const home = bootHome(homeFiles(), "");
  await flushHome();
  assert(home.counts["/data/plugins-lite.json"] === 1, "default homepage fetches the lite envelope once");
  assert(home.counts["/data/list-default-001.json"] === 1, "default homepage fetches list page 1");
  assert(shardUrls(home.counts).length === 0, "default homepage does not fetch lite shards");
  assert(!home.counts["/data/plugins.json"], "default homepage does not fetch the full catalog");
  assert(home.byId.list.innerHTML.includes("Alpha"), "default homepage paints page 1");
  assert(!home.byId.list.innerHTML.includes("From Shard"), "default homepage does not paint shard rows");
  assert(home.byId["st-count"].textContent === "40", "stat count comes from list meta");
  assert(home.byId["st-stars"].textContent === "12,345", "stat stars come from list meta");
  assert(home.byId["st-author"].textContent === "8", "stat authors come from list meta");
  assert(home.byId["st-auto"].textContent === "3", "stat validated comes from list meta");
  assert(home.byId.typer.textContent === "dsh plugin --profile web add github:a/alpha", "typer uses install samples");
  const allCount = home.byId.chips.querySelector(".chip-count");
  assert(allCount && allCount.textContent === "40", "all-count comes from list meta");
  const toolChip = home.byId.chips.children.find((el) => el.getAttribute("data-cat") === "tools");
  assert(toolChip && toolChip.innerHTML.includes("工具") && toolChip.innerHTML.includes("6"), "category chip uses manifest counts");
  assert(home.byId.language.children.some((el) => el.textContent === "Go"), "language dropdown uses manifest languages");
  assert(home.byId["load-more-wrap"].hidden === false, "load more stays available");
  home.byId["load-more"].listeners.click[0]();
  await flushHome();
  assert(home.counts["/data/list-default-002.json"] === 1, "load more fetches the next default page");
  assert(shardUrls(home.counts).length === 0, "load more still does not fetch lite shards");
  assert(home.byId.list.innerHTML.includes("Beta"), "load more appends page 2");
  assert(home.byId["load-more-wrap"].hidden === true, "load more hides when the default pages are exhausted");
  home.byId.q.value = "from";
  home.byId.q.listeners.input[0]();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert(shardUrls(home.counts).length === 1, "search lazy-loads lite shards");
  assert(home.counts["/data/plugins-lite.json"] === 1, "search reuses the envelope");
  assert(home.byId.list.innerHTML.includes("From Shard"), "search renders from the lite shards");
  assert(!home.byId.list.innerHTML.includes(">Alpha<"), "search leaves the default page");

  const deep = bootHome(homeFiles(), "?category=tools");
  await flushHome();
  assert(!deep.counts["/data/list-default-001.json"], "filtered deep link does not fetch default pages");
  assert(deep.counts["/data/plugins-lite-000.json"] === 1, "filtered deep link lazy-loads lite shards");
  assert(deep.byId.list.innerHTML.includes("From Shard"), "filtered deep link renders shard rows");
  assert(deep.byId["st-count"].textContent === "40", "filtered deep link still fills stats from list meta");
} catch (err) {
  assert(false, `homepage harness ${err && err.stack ? err.stack : err}`);
}

const seoCode = await readFile(join(ROOT, "js/seo.js"), "utf8");
function bootSeo(page) {
  let catalog = 0;
  const head = {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    appendChild(el) {
      return el;
    },
  };
  const document = {
    title: "",
    readyState: "complete",
    body: { getAttribute: () => page },
    head,
    getElementById() {
      return null;
    },
    createElement() {
      return { setAttribute() {}, textContent: "" };
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
  };
  const sandbox = {
    document,
    location: { search: "", pathname: "/" },
    URLSearchParams,
    encodeURIComponent,
    CustomEvent,
    DSH: {
      loadCatalog() {
        catalog += 1;
        return Promise.resolve({ plugins: [] });
      },
      plugins() {
        return [];
      },
      desc() {
        return "";
      },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(seoCode, sandbox, { filename: "seo.js" });
  return catalog;
}
assert(bootSeo("index") === 0, "homepage seo does not loadCatalog");
assert(bootSeo("dashboard") === 1, "dashboard seo still loads the catalog");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
