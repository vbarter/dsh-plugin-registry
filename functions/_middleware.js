// www → apex, ?lang= noindex, and hard 404 for Pages SPA soft-200s.
// Unknown paths are served as index.html with status 200. Non-200 responses
// (301/308 from _redirects / html_handling, 410 from the old sitemap Functions)
// pass through unchanged.

const EXACT = new Set([
  "/",
  "/install",
  "/publish",
  "/vs",
  "/dashboard",
  "/policy",
  "/plugin-detail",
  "/index.html",
  "/install.html",
  "/publish.html",
  "/vs.html",
  "/dashboard.html",
  "/policy.html",
  "/plugin-detail.html",
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
  "/llms-full.txt",
  "/favicon.svg",
  "/og.svg",
  "/styles.css",
  "/9856f1bd954f9ff5f39d8b1c63eb3a0e.txt",
  // Pages html_handling 308s `/file.html` → `/file`. Both must stay reachable.
  "/googlecef9e927b2687736.html",
  "/googlecef9e927b2687736",
  "/sitemap-gone.html",
  "/sitemap-gone",
]);

// plugins/<slug>.html that exist in the repo. Anything else under /plugins/ is a soft-200.
const PLUGIN_SLUGS = new Set(["dsh-cc-tui", "dsh-web-ui", "modlens"]);

// _headers forces `Content-Type: application/json` for /data/*.json, including the
// SPA shell. These files are real; every other /data/*.json is peeked.
const DATA_JSON = new Set([
  "/data/config.json",
  "/data/plugins.json",
  "/data/plugins-lite.json",
  "/data/submissions.json",
]);

const ASSET_EXT = /\.(css|js|svg|png|ico|woff2|map|json|txt|xml)$/i;
const ASSET_DIRS = new Set(["js", "data", "plugins", "c", "assets", "fonts", "img", "images", "static"]);

function normalizePath(pathname) {
  let path = pathname || "/";
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  if (!path.startsWith("/")) path = `/${path}`;
  return path;
}

function isAllowed(path) {
  if (EXACT.has(path) || DATA_JSON.has(path)) return true;
  let match = /^\/plugins\/([a-z0-9-]+)(\.html)?$/.exec(path);
  if (match && PLUGIN_SLUGS.has(match[1])) return true;
  match = /^\/c\/(vision|web-ui|tui)(\.html)?$/.exec(path);
  return Boolean(match);
}

function isTypicalAssetPath(path) {
  if (!ASSET_EXT.test(path)) return false;
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0 || parts.includes("..")) return false;
  if (parts.length === 1) return true;
  return ASSET_DIRS.has(parts[0]);
}

// clone()+read deadlocks unless both branches are consumed. Buffer instead.
// Only used for non-allowlisted assets whose Content-Type can lie (SPA shell).
async function readAsset(res) {
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const n = Math.min(bytes.byteLength, start + 64);
  let head = "";
  for (let i = start; i < n; i++) head += String.fromCharCode(bytes[i]);
  const looksLikeHtml = bytes.byteLength === 0 || /^\s*</.test(head);
  const rebuilt = new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
  return { looksLikeHtml, res: rebuilt };
}

// Returns the response to keep, or null when this is not a real static asset.
async function realStaticAsset(path, res) {
  if (!isTypicalAssetPath(path)) return null;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/html")) return null;
  // _headers sets application/json for every /data/*.json, including index.html.
  if ((path.startsWith("/data/") && path.endsWith(".json")) || ct === "" || ct.includes("text/plain")) {
    const peeked = await readAsset(res);
    return peeked.looksLikeHtml ? null : peeked.res;
  }
  return res;
}

function withLang(url, res) {
  if (!url.searchParams.has("lang")) return res;
  const headers = new Headers(res.headers);
  headers.set("X-Robots-Tag", "noindex, follow");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function notFound() {
  return new Response("Not Found\n", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "www.dsplugin.app") {
    url.hostname = "dsplugin.app";
    return Response.redirect(url.toString(), 301);
  }

  const res = await context.next();
  if (res.status !== 200) return withLang(url, res);

  const path = normalizePath(url.pathname);
  if (path && isAllowed(path)) return withLang(url, res);
  if (path) {
    const asset = await realStaticAsset(path, res);
    if (asset) return withLang(url, asset);
  }

  if (!res.bodyUsed) {
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
  }
  return notFound();
}
