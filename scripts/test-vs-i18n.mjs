// /vs stays the indexable Chinese comparison page and picks up EN from js/i18n.js.
//   node scripts/test-vs-i18n.mjs
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { onRequest } from "../functions/_middleware.js";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const ZH_TITLE = "dsplugin vs dshplugin｜DeepSeek Harness 插件目录对比";
const ZH_H1 = "dsplugin.app 和 dshplugin 有何不同";
const ZH_META = "dsplugin.app、dshplugin.app 和 dshplugin.world 都是社区目录，不是官方。本站给中文安装/发布路径，有有效 dsh.bundle 才给安装命令。";
const EN_TITLE = "dsplugin vs dshplugin｜DeepSeek Harness plugin directory comparison";
const EN_H1 = "How dsplugin.app differs from dshplugin";
const EN_META = "dsplugin.app, dshplugin.app, and dshplugin.world are community catalogs, not official. This site offers a Chinese-first install and publish path, and only shows a dsh plugin add command when a valid dsh.bundle is present.";
const EN_BODY = "A Chinese-first install and publish path. Check the source and Manifest first; only show a `dsh plugin add` command when a valid `dsh.bundle` is present. Submissions go: precheck → GitHub Issue → vbarter/dsh-plugin-registry.";

let failed = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`ok  ${message}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${message}`);
}

function textOf(fragment) {
  return fragment.replace(/<[^>]+>/g, "");
}

function bootI18n() {
  const store = new Map();
  const document = {
    title: "",
    readyState: "complete",
    documentElement: { lang: "" },
    body: { getAttribute: (name) => (name === "data-page" ? "vs" : null) },
    addEventListener() {},
    dispatchEvent() {},
    querySelectorAll() {
      return [];
    },
  };
  const sandbox = {
    document,
    location: { href: "https://dsplugin.app/vs", search: "", pathname: "/vs", hash: "" },
    history: { replaceState() {} },
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
    },
    URL,
    URLSearchParams,
    CustomEvent,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(i18nCode, sandbox, { filename: "js/i18n.js" });
  return sandbox;
}

const html = await readFile(join(ROOT, "vs.html"), "utf8");
const i18nCode = await readFile(join(ROOT, "js/i18n.js"), "utf8");
const sitemap = await readFile(join(ROOT, "sitemap.xml"), "utf8");

assert(html.includes(`<title>${ZH_TITLE}</title>`), "frozen ZH title");
assert(html.includes(`<h1 class="page-title" data-i18n="vs.heroTitle">${ZH_H1}</h1>`), "frozen ZH h1");
assert(html.includes(`content="${ZH_META}"`), "frozen ZH meta description");
assert(html.includes('<link rel="canonical" href="https://dsplugin.app/vs">'), "canonical is /vs");
assert((html.match(/rel="canonical"/g) || []).length === 1, "one canonical");
assert(html.includes('<meta property="og:url" content="https://dsplugin.app/vs">'), "og:url stays /vs");
assert(!html.includes("hreflang"), "no hreflang");
assert(!html.includes("/en/vs"), "no /en/vs url");
assert(!html.includes("?lang="), "no lang query in the document");
assert(!/noindex/i.test(html), "bare /vs html has no noindex");
assert(!/name=["']robots["']/i.test(html), "bare /vs html has no robots meta");
assert(html.includes('data-page="vs"'), "data-page=vs");
assert(html.includes('class="lang-toggle"'), "lang toggle");
assert(html.includes('data-lang-set="zh"') && html.includes('data-lang-set="en"'), "zh and en buttons");
assert(html.includes('data-i18n-content="title.vs"'), "title.vs key");
assert(html.includes('data-i18n="vs.heroTitle"'), "vs.heroTitle key");
assert(html.includes('data-i18n-content="meta.vs"'), "meta.vs key");
assert(html.includes('src="/js/i18n.js?v=20261112a"'), "i18n.js cache-buster");
assert(!html.includes("seo.js"), "seo.js is not loaded");
assert(!html.includes('id="seo-jsonld"'), "json-ld is not rewritten by seo.js");
assert((html.match(/<dt\b/g) || []).length === 5, "five visible FAQ questions");
assert(html.includes('href="/install"'), "/install link stays");
assert(html.includes('href="/publish"'), "/publish link stays");
assert(html.includes('href="/"'), "home link stays");
assert(html.includes('href="https://github.com/topics/dsh-plugin"'), "topic link stays");
assert(html.includes('href="https://github.com/vbarter/dsh-plugin-registry"'), "registry link stays");
assert(html.includes("<code>dsh.bundle</code>"), "dsh.bundle code stays");
assert(html.includes("<code>dsh plugin add</code>"), "dsh plugin add code stays");
assert(html.includes('data-i18n="nav.browse"'), "nav.browse");
assert(html.includes('data-i18n="nav.install"'), "nav.install");
assert(html.includes('data-i18n="nav.publish"'), "nav.publish");
assert(html.includes('data-i18n="nav.vs"'), "nav.vs");
assert(html.includes('data-i18n="footer.notOfficial"'), "footer.notOfficial");
assert(html.includes(">Vision<") && html.includes(">Web UI<") && html.includes(">TUI<") && html.includes(">GitHub<"), "proper names stay");
assert(sitemap.includes("<loc>https://dsplugin.app/vs</loc>"), "sitemap still lists /vs");
assert(!sitemap.includes("/vs?lang"), "sitemap does not add a lang url");

const zhBlock = html.match(/<p data-lang-block="zh">([\s\S]*?)<\/p>/);
const enBlock = html.match(/<p data-lang-block="en" hidden>([\s\S]*?)<\/p>/);
assert(zhBlock && zhBlock[1].indexOf("<code>dsh.bundle</code>") < zhBlock[1].indexOf("<code>dsh plugin add</code>"), "zh keeps bundle then add");
assert(enBlock && enBlock[1].indexOf("<code>dsh plugin add</code>") < enBlock[1].indexOf("<code>dsh.bundle</code>"), "en shows add then bundle");

const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
const ld = JSON.parse(ldMatch[1]);
const faq = ld["@graph"].find((node) => node["@type"] === "FAQPage");
assert(faq && faq.mainEntity.length === 5, "FAQPage JSON-LD has five Q&As");

const i18n = bootI18n();
const t = i18n.DSHI18n.t;
assert(i18n.document.title === ZH_TITLE, "data-page=vs sets the ZH title");
assert(t("title.vs") === ZH_TITLE, "zh title.vs");
assert(t("vs.heroTitle") === ZH_H1, "zh vs.heroTitle");
assert(t("meta.vs") === ZH_META, "zh meta.vs");
assert(t("nav.install") === "安装", "zh nav.install");
assert(t("nav.vs") === "对比", "zh nav.vs");
assert(t("footer.notOfficial") === "社区目录 · 不是 DeepSeek 官方站", "zh footer.notOfficial");
function markedText(startKey, endKey) {
  const start = html.indexOf(`data-i18n="${startKey}"`);
  const end = html.indexOf(`data-i18n="${endKey}"`);
  const from = html.lastIndexOf("<", start);
  const close = html.indexOf("</span>", end);
  return textOf(html.slice(from, close + "</span>".length));
}

assert(textOf(zhBlock[1]) === t("vs.body.us"), "visible ZH us sentence matches the dictionary");
assert(markedText("vs.body.scope.before", "vs.body.scope.after") === t("vs.body.scope"), "visible ZH scope sentence matches the dictionary");
assert(markedText("vs.faq.a5.before", "vs.faq.a5.after") === t("vs.faq.a5"), "visible ZH FAQ a5 matches the dictionary");
for (let i = 0; i < 5; i++) {
  const q = faq.mainEntity[i];
  assert(q.name === t(`vs.faq.q${i + 1}`), `JSON-LD q${i + 1} matches visible ZH`);
  assert(q.acceptedAnswer.text === t(`vs.faq.a${i + 1}`), `JSON-LD a${i + 1} matches visible ZH`);
}

i18n.DSHI18n.setLocale("en");
assert(i18n.document.title === EN_TITLE, "EN title.vs drives document.title");
assert(i18n.document.documentElement.lang === "en", "html lang switches to en");
assert(t("title.vs") === EN_TITLE, "en title.vs signed");
assert(t("vs.heroTitle") === EN_H1, "en vs.heroTitle signed");
assert(t("meta.vs") === EN_META, "en meta.vs signed");
assert(t("vs.body.us") === EN_BODY, "en vs.body.us signed");
assert(t("vs.body.us").includes("only show a `dsh plugin add` command"), "en vs.body.us says only show");
assert(!t("vs.body.us").includes("only issue"), "en vs.body.us does not say only issue");
assert(t("nav.install") === "Install", "en nav.install");
assert(t("nav.vs") === "Compare", "en nav.vs");
assert(t("footer.notOfficial") === "Community catalog · not an official DeepSeek site", "en footer.notOfficial");
assert(textOf(enBlock[1]) === EN_BODY.replaceAll("`", ""), "EN us markup reads as the signed sentence");
assert(
  t("vs.body.us.before") + "dsh plugin add" + t("vs.body.us.mid") + "dsh.bundle" + t("vs.body.us.after") + "vbarter/dsh-plugin-registry" + t("vs.body.us.end") ===
    EN_BODY.replaceAll("`", ""),
  "EN split keys rebuild the signed sentence"
);
assert(
  t("vs.body.scope.before") + "dsh-plugin topic" + t("vs.body.scope.mid") + "dsplugin.app" + t("vs.body.scope.after") === t("vs.body.scope"),
  "EN scope split keeps the topic link and domain"
);
assert(
  t("vs.faq.a5.before") + "/install" + t("vs.faq.a5.mid") + "/publish" + t("vs.faq.a5.after") === t("vs.faq.a5"),
  "EN FAQ a5 split keeps /install and /publish"
);

const bare = await onRequest({
  request: new Request("https://dsplugin.app/vs"),
  async next() {
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
assert(bare.status === 200, "/vs → 200");
assert(bare.headers.get("x-robots-tag") == null, "bare /vs has no x-robots-tag");
assert((await bare.text()) === html, "bare /vs body is the page");

const lang = await onRequest({
  request: new Request("https://dsplugin.app/vs?lang=en"),
  async next() {
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
assert(lang.status === 200, "/vs?lang=en → 200");
assert(lang.headers.get("x-robots-tag") === "noindex, follow", "/vs?lang=en keeps noindex, follow");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
