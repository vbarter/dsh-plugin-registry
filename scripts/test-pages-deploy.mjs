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
  assert(!existsSync(join(outDir, "data/plugins.json")), "upload still omits data/plugins.json");

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
