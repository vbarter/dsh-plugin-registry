#!/usr/bin/env node
/**
 * Scan GitHub for topic:dsh-plugin, classify DSH plugins, merge into data/plugins.json.
 * Node 20+, no extra deps. Uses GITHUB_TOKEN when present.
 *
 *   node scripts/discover.mjs
 *   node scripts/discover.mjs --repo owner/repo [--source curated|discovered]
 *   node scripts/discover.mjs --ingest
 *   node scripts/discover.mjs --review-curated
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_PATH = join(ROOT, "data", "plugins.json");
const SUBMISSIONS_PATH = join(ROOT, "data", "submissions.json");
const CONFIG_PATH = join(ROOT, "data", "config.json");
const RESULT_PATH = process.env.INGEST_RESULT || "/tmp/dsh-ingest-result.json";

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const UA = "dsh-plugin-registry-discover";
const CONCURRENCY = TOKEN ? 6 : 2;
const DROP_ABORT_RATIO = 0.4;

const PLUGIN_KEYS = [
  "id", "name", "owner", "url", "description", "category",
  "stars", "forks", "language", "pushedAt", "addedAt",
  "source", "trustLevel", "verification", "install",
  "archived", "topics", "icon",
];

const TOPIC_CAT = [
  [/theme|appearance|skin/, "theme"],
  [/\bui\b|web-ui|tui|terminal/, "ui"],
  [/memory|rag|recall/, "memory"],
  [/notif|telegram|slack|discord|feishu|lark/, "notify"],
  [/workflow|automat/, "workflow"],
  [/skill/, "skill"],
  [/model|provider|llm|openai/, "model"],
  [/session|message|chat/, "session"],
  [/market|registry|manager/, "market"],
  [/\bfun\b|pet|toy/, "fun"],
  [/runtime|dev|debug|sandbox/, "dev"],
];

function args() {
  const out = { repo: "", source: "", ingest: false, reviewCurated: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo") out.repo = argv[++i] || "";
    else if (argv[i] === "--source") out.source = argv[++i] || "";
    else if (argv[i] === "--ingest") out.ingest = true;
    else if (argv[i] === "--review-curated") out.reviewCurated = true;
  }
  return out;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ghHeaders(extra) {
  const h = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": UA,
    ...extra,
  };
  if (TOKEN) h.Authorization = "Bearer " + TOKEN;
  return h;
}

async function ghFetch(url, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method,
      headers: ghHeaders(opts.headers),
    });
    if (res.status === 403 || res.status === 429) {
      const retry = Number(res.headers.get("retry-after") || 0);
      const remain = res.headers.get("x-ratelimit-remaining");
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0);
      const wait = retry
        ? retry * 1000
        : remain === "0" && reset
          ? Math.max(1000, reset * 1000 - Date.now() + 500)
          : 1500 * (attempt + 1);
      if (attempt < 4 && wait < 90_000) {
        console.warn("rate-limited, waiting", wait, "ms", url);
        await sleep(wait);
        continue;
      }
      const err = new Error("GitHub rate limited: " + res.status + " " + url);
      err.status = res.status;
      err.rateLimited = true;
      throw err;
    }
    return res;
  }
  const err = new Error("GitHub request failed: " + url);
  err.rateLimited = true;
  throw err;
}

function parseLinkNext(link) {
  if (!link) return "";
  const parts = link.split(",");
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return "";
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function isSafePatch(patch) {
  if (typeof patch !== "string" || !patch.trim()) return false;
  const p = patch.trim().replace(/^\.\//, "");
  if (!p) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (p.split(/[\\/]/).includes("..")) return false;
  if (p.includes("..")) return false;
  return true;
}

function isDshRelated(pkg, repo) {
  const text = [
    pkg && pkg.name,
    pkg && pkg.description,
    repo && repo.name,
    repo && repo.description,
    ((repo && repo.topics) || []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    /\bdsh\b/.test(text) ||
    text.includes("deepseek-harness") ||
    text.includes("deepseek harness") ||
    text.includes("dsh-plugin") ||
    text.includes("dshdesk")
  );
}

function isDshPlugin(repo, pkg) {
  const topics = (repo && repo.topics) || [];
  if (!topics.includes("dsh-plugin")) return false;
  if (!pkg || typeof pkg !== "object") return false;
  if (pkg.dsh && pkg.dsh.bundle && typeof pkg.dsh.bundle === "object") return true;
  if (pkg.dsh && pkg.dsh.plugin) return true;
  return isDshRelated(pkg, repo);
}

function guessCategory(repo, pkg) {
  const text = [
    ((repo && repo.topics) || []).join(" "),
    repo && repo.description,
    pkg && pkg.description,
    pkg && pkg.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const [re, cat] of TOPIC_CAT) {
    if (re.test(text)) return cat;
  }
  return "tools";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function orderPlugin(p) {
  const out = {};
  for (const k of PLUGIN_KEYS) {
    if (k in p) out[k] = p[k];
  }
  for (const k of Object.keys(p)) {
    if (!(k in out)) out[k] = p[k];
  }
  return out;
}

function slugOf(owner, repo) {
  return owner + "/" + repo;
}

function matchesRepo(plugin, owner, repo) {
  const slug = slugOf(owner, repo).toLowerCase();
  const id = String(plugin.id || "").toLowerCase();
  if (id === slug || id.startsWith(slug + "#")) return true;
  const url = String(plugin.url || "").toLowerCase();
  return url.includes("github.com/" + slug);
}

async function searchTopic(topic) {
  const found = new Map();
  let totalHint = 0;
  const shards = [
    `topic:${topic} archived:false fork:false stars:>=20`,
    `topic:${topic} archived:false fork:false stars:5..19`,
    `topic:${topic} archived:false fork:false stars:1..4`,
    `topic:${topic} archived:false fork:false stars:0`,
    `topic:${topic} archived:false`,
  ];

  async function runQuery(q) {
    let url =
      "https://api.github.com/search/repositories?q=" +
      encodeURIComponent(q) +
      "&per_page=100&sort=updated";
    let pages = 0;
    while (url && pages < 10) {
      const res = await ghFetch(url);
      if (!res.ok) {
        const body = await res.text();
        throw new Error("search failed " + res.status + " " + body.slice(0, 200));
      }
      const data = await res.json();
      if (typeof data.total_count === "number") {
        totalHint = Math.max(totalHint, data.total_count);
      }
      for (const item of data.items || []) {
        const key = (item.full_name || "").toLowerCase();
        if (key) found.set(key, item);
      }
      url = parseLinkNext(res.headers.get("link"));
      pages += 1;
      if ((data.items || []).length < 100) break;
    }
    return { total: totalHint, pages };
  }

  for (const q of shards) {
    try {
      const r = await runQuery(q);
      if (r.total > 1000 && q.includes("stars:")) {
        const years = [2023, 2024, 2025, 2026];
        for (const y of years) {
          await runQuery(q + ` created:${y}-01-01..${y}-12-31`);
        }
      }
    } catch (err) {
      if (err.rateLimited) {
        console.warn("search stopped (rate limit):", err.message);
        break;
      }
      throw err;
    }
  }

  return { repos: [...found.values()], topicCandidates: Math.max(totalHint, found.size) };
}

async function getPackageJson(owner, repo, branch) {
  const contents =
    "https://api.github.com/repos/" +
    owner +
    "/" +
    repo +
    "/contents/package.json";
  try {
    const res = await ghFetch(contents);
    if (res.ok) {
      const data = await res.json();
      if (data && data.content) {
        const raw = Buffer.from(data.content, "base64").toString("utf8");
        return JSON.parse(raw);
      }
    }
    if (res.status === 404) return null;
  } catch (err) {
    if (err.rateLimited) throw err;
  }

  const refs = [branch, "HEAD", "main", "master"].filter(Boolean);
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const rawUrl =
      "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + ref + "/package.json";
    try {
      const res = await fetch(rawUrl, { headers: { "User-Agent": UA } });
      if (res.ok) return await res.json();
    } catch (err) {
      /* try next */
    }
  }
  return null;
}

async function headPatch(owner, repo, branch, patch) {
  const rel = String(patch).replace(/^\.\//, "");
  const refs = [branch, "HEAD", "main"].filter(Boolean);
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const url = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + ref + "/" + rel;
    try {
      const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
      if (res.status === 200) return "exists";
      if (res.status === 404) return "missing";
    } catch (err) {
      /* keep not_checked */
    }
  }
  return "not_checked";
}

async function classifyRepo(repoMeta, source) {
  const owner = repoMeta.owner && repoMeta.owner.login ? repoMeta.owner.login : repoMeta.full_name.split("/")[0];
  const name = repoMeta.name;
  const branch = repoMeta.default_branch || "main";
  const topics = repoMeta.topics || [];
  const pkg = await getPackageJson(owner, name, branch);
  if (!isDshPlugin({ ...repoMeta, topics, name, description: repoMeta.description }, pkg)) {
    return null;
  }

  const patch = pkg && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
  const safe = isSafePatch(patch);
  const manifest = safe ? "shape_validated" : "not_validated";
  let patchStatus = "not_checked";
  if (safe) {
    try {
      patchStatus = await headPatch(owner, name, branch, patch);
    } catch (err) {
      patchStatus = "not_checked";
    }
  }

  const descText = (pkg && pkg.description) || repoMeta.description || "";
  const src = source || "discovered";
  return {
    id: slugOf(owner, name),
    name: (pkg && pkg.name) || name,
    owner,
    url: repoMeta.html_url || "https://github.com/" + slugOf(owner, name),
    description: { zh: descText, en: descText },
    category: guessCategory(repoMeta, pkg),
    stars: repoMeta.stargazers_count || 0,
    forks: repoMeta.forks_count || 0,
    language: repoMeta.language || "",
    pushedAt: repoMeta.pushed_at || null,
    addedAt: today(),
    source: src,
    trustLevel: src === "curated" ? "curated" : safe ? "manifest_verified" : "discovered",
    verification: {
      manifest,
      patch: patchStatus,
      installation: "not_tested",
    },
    install: safe ? "dsh plugin --profile web add github:" + slugOf(owner, name) : "",
    archived: !!repoMeta.archived,
    topics,
    icon: (repoMeta.owner && repoMeta.owner.avatar_url) || "",
  };
}

async function fetchRepo(owner, repo) {
  const res = await ghFetch("https://api.github.com/repos/" + owner + "/" + repo);
  if (res.status === 404) return { missing: true };
  if (!res.ok) {
    const err = new Error("repo fetch " + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function recomputeStats(catalog, topicCandidates, mode) {
  const list = catalog.plugins;
  let curated = 0;
  let discovered = 0;
  let patchOk = 0;
  let rejected = 0;
  for (const p of list) {
    if (p.source === "curated") curated += 1;
    else discovered += 1;
    if (p.verification && p.verification.patch === "exists") patchOk += 1;
    if (p.verification && p.verification.manifest === "not_validated") rejected += 1;
  }
  catalog.stats = {
    topicCandidates: topicCandidates || (catalog.stats && catalog.stats.topicCandidates) || list.length,
    curated,
    automaticallyDiscovered: discovered,
    patchFilesConfirmed: patchOk,
    published: list.length,
    manifestRejected: rejected,
    pendingReview: rejected,
    quarantined: (catalog.stats && catalog.stats.quarantined) || 0,
    discoveryMode: mode,
  };
  catalog.generatedAt = new Date().toISOString();
  return catalog;
}

function writeCatalog(catalog) {
  const ordered = {
    schemaVersion: catalog.schemaVersion || 2,
    generatedAt: catalog.generatedAt,
    categories: catalog.categories,
    stats: catalog.stats,
    sources: catalog.sources || {
      curated: "https://awesome-dsh-plugin.com/plugins.json",
      discovery: "https://github.com/topics/dsh-plugin",
    },
    plugins: (catalog.plugins || []).map(orderPlugin),
  };
  const text = JSON.stringify(ordered, null, 2) + "\n";
  return writeFile(PLUGINS_PATH, text, "utf8");
}

function mergeLive(existing, live, source) {
  const owner = live.owner;
  const repo = live.id.split("/")[1];
  const hits = existing.filter((p) => matchesRepo(p, owner, repo));
  if (!hits.length) {
    return { plugins: existing.concat([live]), action: "added" };
  }
  const next = existing.map((p) => {
    if (!matchesRepo(p, owner, repo)) return p;
    const keep = { ...p };
    keep.stars = live.stars;
    keep.forks = live.forks;
    keep.pushedAt = live.pushedAt;
    if (live.icon) keep.icon = live.icon;
    if (live.language && !keep.language) keep.language = live.language;
    if (live.topics && live.topics.length) keep.topics = live.topics;
    if (p.source === "discovered") {
      keep.verification = live.verification;
      keep.install = live.install || keep.install;
      keep.trustLevel = live.trustLevel;
      if (source === "curated") {
        keep.source = "curated";
        keep.trustLevel = "curated";
      }
    } else if (source === "curated" && p.source === "curated") {
      if (live.verification) {
        keep.verification = live.verification;
        if (live.install) keep.install = live.install;
      }
    }
    return keep;
  });
  return { plugins: next, action: "updated" };
}

async function fullScan() {
  const catalog = await readJson(PLUGINS_PATH);
  const config = await readJson(CONFIG_PATH, { topic: "dsh-plugin" });
  const topic = config.topic || "dsh-plugin";
  const prevPublished = (catalog.stats && catalog.stats.published) || (catalog.plugins || []).length;

  console.log("searching topic:" + topic + (TOKEN ? " (authenticated)" : " (unauthenticated)"));
  let search;
  try {
    search = await searchTopic(topic);
  } catch (err) {
    if (err.rateLimited) {
      console.warn("search rate-limited; leaving existing snapshot");
      return { wrote: false, reason: "rate_limited" };
    }
    throw err;
  }

  console.log("search hits", search.repos.length, "topicCandidates~", search.topicCandidates);
  if (!search.repos.length) {
    console.warn("no search hits; leaving existing snapshot");
    return { wrote: false, reason: "empty_search" };
  }

  const liveBySlug = new Map();
  let classified = 0;
  let skipped = 0;
  let classifyLimited = false;
  try {
    await mapPool(search.repos, CONCURRENCY, async (repo) => {
      if (repo.archived || repo.fork) {
        skipped += 1;
        return;
      }
      try {
        const live = await classifyRepo(repo, "discovered");
        if (live) {
          liveBySlug.set(live.id.toLowerCase(), live);
          classified += 1;
        } else {
          skipped += 1;
        }
      } catch (err) {
        if (err.rateLimited) throw err;
        skipped += 1;
      }
    });
  } catch (err) {
    if (!err.rateLimited) throw err;
    classifyLimited = true;
    console.warn("classify stopped (rate limit); treating scan as partial");
  }

  console.log("classified", classified, "skipped", skipped);

  const foundSlugs = new Set(liveBySlug.keys());
  const kept = [];
  const vanished = [];

  for (const p of catalog.plugins || []) {
    const slugHits = [...liveBySlug.values()].filter((live) =>
      matchesRepo(p, live.owner, live.id.split("/")[1])
    );
    if (p.source === "curated") {
      if (slugHits[0]) {
        const live = slugHits[0];
        kept.push({
          ...p,
          stars: live.stars,
          forks: live.forks,
          pushedAt: live.pushedAt,
          icon: live.icon || p.icon,
        });
      } else {
        kept.push(p);
      }
      continue;
    }
    if (slugHits[0]) {
      const live = slugHits[0];
      kept.push({
        ...p,
        stars: live.stars,
        forks: live.forks,
        pushedAt: live.pushedAt,
        icon: live.icon || p.icon,
        topics: live.topics && live.topics.length ? live.topics : p.topics,
        verification: live.verification,
        install: live.install || p.install,
        trustLevel: live.trustLevel,
        language: live.language || p.language,
      });
    } else {
      vanished.push(p);
    }
  }

  const existingKeys = new Set();
  for (const p of kept) {
    existingKeys.add(String(p.id || "").toLowerCase());
    if (p.owner && p.url) {
      const m = String(p.url).match(/github\.com\/([^/#]+\/[^/#]+)/i);
      if (m) existingKeys.add(m[1].toLowerCase());
    }
  }

  for (const live of liveBySlug.values()) {
    const slug = live.id.toLowerCase();
    const already = kept.some((p) => matchesRepo(p, live.owner, live.id.split("/")[1]));
    if (!already && !existingKeys.has(slug)) {
      kept.push(live);
      existingKeys.add(slug);
    }
  }

  // Drop discovered that vanished AND are archived/missing. Keep if we cannot confirm.
  // Skip probing on a partial scan so we do not hammer the API or drop live rows.
  const prevDiscovered = (catalog.plugins || []).filter((p) => p.source === "discovered").length;
  const partial = classifyLimited || search.repos.length < Math.max(80, prevDiscovered * 0.4);
  const dropIds = new Set();
  if (!partial && vanished.length) {
    await mapPool(vanished, Math.min(4, CONCURRENCY), async (p) => {
      const m = String(p.id || "").match(/^([^/#]+)\/([^/#]+)/);
      if (!m) return;
      try {
        const meta = await fetchRepo(m[1], m[2]);
        if (meta.missing || meta.archived) dropIds.add(p.id);
      } catch (err) {
        /* keep on uncertainty */
      }
    });
  } else if (vanished.length) {
    console.warn("partial scan — keeping", vanished.length, "unseen discovered rows");
  }

  const merged = kept.filter((p) => !dropIds.has(p.id));
  for (const p of vanished) {
    if (!dropIds.has(p.id)) merged.push(p);
  }

  const nextPublished = merged.length;
  if (prevPublished > 0 && nextPublished < prevPublished * (1 - DROP_ABORT_RATIO)) {
    console.error(
      "abort write: published " + prevPublished + " → " + nextPublished + " (drop > 40%)"
    );
    return { wrote: false, reason: "safety_abort" };
  }

  catalog.plugins = merged;
  const mode = partial || search.repos.length < 50 ? "partial" : "complete";
  recomputeStats(catalog, search.topicCandidates, mode);
  await writeCatalog(catalog);
  console.log("wrote", PLUGINS_PATH, "published", catalog.stats.published);
  return { wrote: true, published: catalog.stats.published };
}

async function ingestOne(owner, repo, source) {
  const catalog = await readJson(PLUGINS_PATH);
  const submissions = await readJson(SUBMISSIONS_PATH, []);
  const meta = await fetchRepo(owner, repo);
  if (meta.missing) {
    return { ok: false, action: "error", message: "repository not found or private: " + owner + "/" + repo };
  }
  const live = await classifyRepo(meta, source || "discovered");
  if (!live) {
    const pending = {
      id: slugOf(owner, repo),
      url: "https://github.com/" + slugOf(owner, repo),
      submittedAt: new Date().toISOString(),
      issue: Number(process.env.ISSUE_NUMBER || 0) || null,
      reason: "not a DSH plugin (missing dsh-plugin topic or dsh.bundle / dsh.plugin / dsh-related package.json)",
      status: "pending",
    };
    const exists = submissions.some((s) => String(s.id).toLowerCase() === pending.id.toLowerCase());
    if (!exists) submissions.push(pending);
    await writeFile(SUBMISSIONS_PATH, JSON.stringify(submissions, null, 2) + "\n", "utf8");
    return {
      ok: true,
      action: "pending",
      repo: pending.id,
      message: "Not classified as a DSH plugin. Recorded in data/submissions.json as pending.",
    };
  }

  const validated = live.verification.manifest === "shape_validated";
  if (source === "curated" || validated) {
    live.source = source === "discovered" && !validated ? "discovered" : (source || "curated");
    if (live.source === "curated") live.trustLevel = "curated";
    const merged = mergeLive(catalog.plugins, live, live.source);
    catalog.plugins = merged.plugins;
    recomputeStats(catalog, catalog.stats && catalog.stats.topicCandidates, "ingest");
    await writeCatalog(catalog);
    return {
      ok: true,
      action: live.source === "curated" ? "curated" : "discovered",
      repo: live.id,
      manifest: live.verification.manifest,
      message:
        live.source === "curated"
          ? "Manifest validated. Drafted into data/plugins.json as source: curated."
          : "Added/updated in data/plugins.json as discovered.",
    };
  }

  const pending = {
    id: live.id,
    url: live.url,
    submittedAt: new Date().toISOString(),
    issue: Number(process.env.ISSUE_NUMBER || 0) || null,
    reason: "manifest " + live.verification.manifest,
    status: "pending",
    verification: live.verification,
  };
  const exists = submissions.some((s) => String(s.id).toLowerCase() === pending.id.toLowerCase());
  if (!exists) submissions.push(pending);
  await writeFile(SUBMISSIONS_PATH, JSON.stringify(submissions, null, 2) + "\n", "utf8");
  return {
    ok: true,
    action: "pending",
    repo: live.id,
    manifest: live.verification.manifest,
    message: "Manifest not validated. Recorded in data/submissions.json as pending.",
  };
}

function extractRepo(text) {
  const raw = String(text || "");
  const url = raw.match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (url) return { owner: url[1], repo: url[2].replace(/\.git$/i, "") };
  const short = raw.match(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/);
  if (short && short[1] !== "http" && short[1] !== "https") {
    return { owner: short[1], repo: short[2].replace(/\.git$/i, "") };
  }
  return null;
}

async function ingestFromIssue() {
  const body = process.env.ISSUE_BODY || "";
  const parsed = extractRepo(body);
  if (!parsed) {
    const result = {
      ok: false,
      action: "error",
      message: "No GitHub repository URL or owner/repo found in the issue body.",
    };
    await writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");
    return result;
  }
  const result = await ingestOne(parsed.owner, parsed.repo, "curated");
  result.issue = Number(process.env.ISSUE_NUMBER || 0) || null;
  await mkdir(dirname(RESULT_PATH), { recursive: true });
  await writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");
  return result;
}

function parsePluginRepo(plugin) {
  const idMatch = String(plugin.id || "").match(/^([^/#]+)\/([^/#]+)/);
  if (idMatch) return { owner: idMatch[1], repo: idMatch[2] };
  return extractRepo(plugin.url);
}

async function reviewCurated() {
  const catalog = await readJson(PLUGINS_PATH);
  const plugins = catalog.plugins || [];
  const targets = plugins.filter((p) => {
    if (p.source !== "curated") return false;
    const manifest = p.verification && p.verification.manifest;
    return !manifest || manifest === "not_checked";
  });

  let checked = 0;
  let validated = 0;
  let missing = 0;
  let errors = 0;
  let unchanged = plugins.filter((p) => p.source === "curated").length - targets.length;

  await mapPool(targets, CONCURRENCY, async (plugin) => {
    checked += 1;
    const parsed = parsePluginRepo(plugin);
    if (!parsed) {
      plugin.verification = { ...(plugin.verification || {}), manifest: "not_validated" };
      missing += 1;
      return;
    }
    try {
      const meta = await fetchRepo(parsed.owner, parsed.repo);
      if (!meta || meta.missing) {
        plugin.verification = { ...(plugin.verification || {}), manifest: "not_validated" };
        missing += 1;
        return;
      }
      const live = await classifyRepo(meta, "curated");
      if (!live) {
        plugin.verification = { ...(plugin.verification || {}), manifest: "not_validated" };
        missing += 1;
        return;
      }
      plugin.verification = live.verification;
      if (live.install) plugin.install = live.install;
      plugin.stars = live.stars;
      plugin.forks = live.forks;
      plugin.pushedAt = live.pushedAt;
      if (live.icon) plugin.icon = live.icon;
      if (live.language) plugin.language = live.language;
      if (live.topics && live.topics.length) plugin.topics = live.topics;
      plugin.source = "curated";
      plugin.trustLevel = "curated";
      if (live.verification && live.verification.manifest === "shape_validated") validated += 1;
      else missing += 1;
    } catch (err) {
      errors += 1;
      console.warn("review-curated error", plugin.id || plugin.url, err.message || err);
    }
  });

  recomputeStats(catalog, catalog.stats && catalog.stats.topicCandidates, "review_curated");
  await writeCatalog(catalog);
  console.log(
    "review-curated checked",
    checked,
    "validated",
    validated,
    "missing/not_validated",
    missing,
    "errors",
    errors,
    "unchanged",
    unchanged
  );
  return { wrote: true, checked, validated, missing, errors, unchanged };
}

async function main() {
  const a = args();
  if (a.ingest) {
    const r = await ingestFromIssue();
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok && r.action === "error" && !r.message.includes("No GitHub")) process.exitCode = 1;
    return;
  }
  if (a.reviewCurated) {
    const r = await reviewCurated();
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (a.repo) {
    const parts = a.repo.split("/");
    if (parts.length !== 2) {
      console.error("expected --repo owner/repo");
      process.exit(1);
    }
    const r = await ingestOne(parts[0], parts[1], a.source || "discovered");
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const r = await fullScan();
  if (!r.wrote) process.exitCode = r.reason === "safety_abort" ? 2 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
