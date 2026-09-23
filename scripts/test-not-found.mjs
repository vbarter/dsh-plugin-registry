// Simulates Cloudflare Pages SPA soft-200 (unknown path → index.html, status 200)
// and checks functions/_middleware.js. Run: node scripts/test-not-found.mjs
import { onRequest } from "../functions/_middleware.js";

const INDEX = `<!doctype html><html><head><link rel="canonical" href="https://dsplugin.app/"></head><body data-page="index"></body></html>`;
const VISION = `<!doctype html><html><head><link rel="canonical" href="https://dsplugin.app/c/vision"></head><body data-page="vision"></body></html>`;

let failed = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`ok  ${message}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${message}`);
}

function ctx(path, { status = 200, contentType = "text/html; charset=utf-8", body = INDEX, hostname = "dsplugin.app", nextCalls = { n: 0 } } = {}) {
  return {
    request: new Request(`https://${hostname}${path}`),
    async next() {
      nextCalls.n += 1;
      return new Response(body, { status, headers: { "content-type": contentType } });
    },
  };
}

async function statusOf(path, opts) {
  const res = await onRequest(ctx(path, opts));
  return { res, text: await res.text() };
}

const harness = await statusOf("/c/harness");
assert(harness.res.status === 404, "/c/harness → 404");
assert(harness.text === "Not Found\n", "/c/harness body is plain Not Found");
assert(!harness.text.includes("data-page"), "/c/harness body is not the homepage");
assert(harness.res.headers.get("x-robots-tag") === "noindex", "/c/harness noindex");
assert(harness.res.headers.get("content-type").includes("text/plain"), "/c/harness text/plain");

const harnessSlash = await statusOf("/c/harness/");
assert(harnessSlash.res.status === 404, "/c/harness/ → 404");

const harnessHtml = await statusOf("/c/harness.html");
assert(harnessHtml.res.status === 404, "/c/harness.html → 404");

const otherC = await statusOf("/c/not-a-topic");
assert(otherC.res.status === 404, "/c/not-a-topic → 404");

const missing = await statusOf("/not-a-page");
assert(missing.res.status === 404, "/not-a-page → 404");

const home = await statusOf("/", { body: INDEX });
assert(home.res.status === 200, "/ → 200");
assert(home.text.includes("data-page=\"index\""), "/ keeps homepage body");

const install = await statusOf("/install");
assert(install.res.status === 200, "/install → 200");
const installSlash = await statusOf("/install/");
assert(installSlash.res.status === 200, "/install/ → 200");
const installHtml = await statusOf("/install.html", { status: 301, contentType: "text/plain;charset=UTF-8", body: "" });
assert(installHtml.res.status === 301, "/install.html 301 passes through");

for (const path of ["/publish", "/vs", "/dashboard", "/policy", "/plugin-detail", "/c/vision", "/c/web-ui", "/c/tui"]) {
  const res = await statusOf(path, { body: path.startsWith("/c/") ? VISION : INDEX });
  assert(res.res.status === 200, `${path} → 200`);
}

for (const path of ["/c/vision.html", "/c/web-ui/", "/c/tui.html"]) {
  const res = await statusOf(path, { status: 308, contentType: "text/plain", body: "" });
  assert(res.res.status === 308, `${path} redirect passes through`);
}

const modlens = await statusOf("/plugins/modlens");
assert(modlens.res.status === 200, "/plugins/modlens → 200");
for (const path of ["/plugins/dsh-web-ui", "/plugins/dsh-cc-tui", "/plugins/modlens.html", "/plugins/modlens/"]) {
  const res = await statusOf(path);
  assert(res.res.status === 200, `${path} → 200`);
}
const nopePlugin = await statusOf("/plugins/nope");
assert(nopePlugin.res.status === 404, "/plugins/nope → 404");

for (const path of [
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
  "/llms-full.txt",
  "/favicon.svg",
  "/og.svg",
  "/styles.css",
  "/9856f1bd954f9ff5f39d8b1c63eb3a0e.txt",
  "/googlecef9e927b2687736",
  "/sitemap-gone",
  "/data/plugins.json",
  "/data/plugins-lite.json",
  "/data/config.json",
  "/data/submissions.json",
]) {
  const res = await statusOf(path, {
    contentType: path.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain",
    body: path.endsWith(".json") ? "{\"ok\":true}" : "asset",
  });
  assert(res.res.status === 200, `${path} → 200`);
}

const js = await statusOf("/js/i18n.js?v=20260917lite", {
  contentType: "application/javascript",
  body: "export {}",
});
assert(js.res.status === 200, "/js/i18n.js → 200");
assert(js.text === "export {}", "/js/i18n.js body preserved");

const jsMissing = await statusOf("/js/nope.js");
assert(jsMissing.res.status === 404, "/js/nope.js soft-200 → 404");

const png = await statusOf("/missing.png");
assert(png.res.status === 404, "/missing.png soft-200 → 404");

const dataNope = await statusOf("/data/nope.json", {
  contentType: "application/json; charset=utf-8",
  body: INDEX,
});
assert(dataNope.res.status === 404, "/data/nope.json masked SPA shell → 404");

const dataReal = await statusOf("/data/extra.json", {
  contentType: "application/json; charset=utf-8",
  body: "{\"plugins\":[]}",
});
assert(dataReal.res.status === 200, "/data/extra.json real JSON → 200");

const stream = new ReadableStream({
  pull(controller) {
    controller.enqueue(new TextEncoder().encode("{\"big\":true}"));
    controller.close();
  },
});
const big = await onRequest({
  request: new Request("https://dsplugin.app/data/plugins.json"),
  async next() {
    return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert(big.status === 200, "/data/plugins.json → 200");
assert(big.bodyUsed === false, "/data/plugins.json body is not consumed");
assert((await big.text()) === "{\"big\":true}", "/data/plugins.json body intact");

for (const path of [
  "/sitemap-plugins.xml",
  "/sitemap-static.xml",
  "/sitemap-index.xml",
  "/sitemap_index.xml",
  "/sitemapindex.xml",
]) {
  const res = await statusOf(path, {
    status: 410,
    contentType: "text/plain; charset=utf-8",
    body: "Gone. Use /sitemap.xml.\n",
  });
  assert(res.res.status === 410, `${path} → 410`);
  assert(res.text.startsWith("Gone."), `${path} keeps Gone body`);
}

const lang = await statusOf("/?lang=en");
assert(lang.res.status === 200, "/?lang=en → 200");
assert(lang.res.headers.get("x-robots-tag") === "noindex, follow", "/?lang=en sets noindex, follow");

const wwwCalls = { n: 0 };
const www = await onRequest(ctx("/c/harness", { hostname: "www.dsplugin.app", nextCalls: wwwCalls }));
assert(www.status === 301, "www → 301");
assert(www.headers.get("location") === "https://dsplugin.app/c/harness", "www location is apex");
assert(wwwCalls.n === 0, "www redirect does not call next()");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
