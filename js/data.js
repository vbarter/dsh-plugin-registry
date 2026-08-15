/* Catalog loader + field helpers. Loads plugins.json once and keeps it in memory. */
(function (global) {
  const DATA_URL = "data/plugins.json";
  let cache = null;
  let inflight = null;

  function t(key, vars) {
    if (global.DSHI18n && typeof DSHI18n.t === "function") return DSHI18n.t(key, vars);
    return key;
  }

  function locale() {
    return (global.DSHI18n && DSHI18n.locale) || "zh";
  }

  function loadCatalog() {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = fetch(DATA_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("无法读取注册表 JSON（" + res.status + "）");
        return res.json();
      })
      .then(function (data) {
        cache = data;
        inflight = null;
        return data;
      })
      .catch(function (err) {
        inflight = null;
        throw err;
      });
    return inflight;
  }

  function getCatalog() {
    return cache;
  }

  function plugins() {
    return (cache && cache.plugins) || [];
  }

  function categories() {
    return (cache && cache.categories) || {};
  }

  function stats() {
    return (cache && cache.stats) || {};
  }

  function desc(plugin) {
    const d = plugin && plugin.description;
    if (!d) return "";
    if (typeof d === "string") return d;
    const loc = locale();
    return d[loc] || d.zh || d.en || "";
  }

  function descAll(plugin) {
    const d = plugin && plugin.description;
    if (!d) return "";
    if (typeof d === "string") return d;
    return [d.zh, d.en].filter(Boolean).join(" ");
  }

  function categoryName(key) {
    const c = categories()[key];
    if (!c) return key || t("label.uncategorized");
    const loc = locale();
    return c[loc] || c.zh || c.en || key;
  }

  function sourceLabel(plugin) {
    const src = typeof plugin === "string" ? plugin : plugin && plugin.source;
    return t("label.source." + src) || src || t("label.uncategorized");
  }

  function manifestKey(plugin) {
    return (plugin && plugin.verification && plugin.verification.manifest) || "not_checked";
  }

  function manifestLabel(plugin) {
    return t("label.manifest." + manifestKey(plugin));
  }

  function manifestPillClass(plugin) {
    const key = manifestKey(plugin);
    if (key === "shape_validated") return "pill pill-manifest";
    if (key === "not_validated") return "pill pill-pending";
    return "pill pill-unchecked";
  }

  function patchLabel(plugin) {
    const key = plugin && plugin.verification && plugin.verification.patch;
    return t("label.patch." + (key || "not_checked"));
  }

  function installationLabel(plugin) {
    const key = plugin && plugin.verification && plugin.verification.installation;
    return t("label.install." + (key || "not_tested"));
  }

  function findPlugin(id) {
    if (!id) return null;
    const decoded = decodeURIComponent(id);
    return plugins().find(function (p) {
      return p.id === id || p.id === decoded;
    }) || null;
  }

  function formatNum(n) {
    const v = Number(n) || 0;
    return v.toLocaleString("en-US");
  }

  function relTime(iso) {
    if (!iso) return t("time.unknown");
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return iso;
    const diff = Date.now() - ts;
    const sec = Math.round(diff / 1000);
    if (sec < 45) return t("time.justNow");
    const min = Math.round(sec / 60);
    if (min < 60) return t("time.minutes", { n: min });
    const hr = Math.round(min / 60);
    if (hr < 24) return t("time.hours", { n: hr });
    const day = Math.round(hr / 24);
    if (day < 30) return t("time.days", { n: day });
    const mo = Math.round(day / 30);
    if (mo < 12) return t("time.months", { n: mo });
    return t("time.years", { n: Math.round(day / 365) });
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initial(plugin) {
    const name = (plugin && (plugin.name || plugin.owner)) || "?";
    const ch = name.replace(/^[@#]/, "").charAt(0);
    return (ch || "?").toUpperCase();
  }

  function avatarHtml(plugin, size) {
    const cls = "pavatar" + (size === "lg" ? " lg" : "");
    const letter = escapeHtml(initial(plugin));
    const icon = plugin && plugin.icon;
    if (icon) {
      return (
        '<span class="' + cls + ' has-image" aria-hidden="true">' +
        '<span class="pavatar-fallback">' + letter + "</span>" +
        '<img src="' + escapeHtml(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove(\'has-image\')">' +
        "</span>"
      );
    }
    return '<span class="' + cls + '" aria-hidden="true">' + letter + "</span>";
  }

  function readQuery() {
    const p = new URLSearchParams(location.search);
    return {
      q: p.get("q") || "",
      category: p.get("category") || "all",
      source: p.get("source") || "all",
      manifest: p.get("manifest") || "all",
      language: p.get("language") || "all",
      sort: p.get("sort") || "relevance",
      plugin: p.get("plugin") || "",
      lang: p.get("lang") || "",
    };
  }

  function writeQuery(state, extra) {
    const next = Object.assign({}, state, extra || {});
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.category && next.category !== "all") p.set("category", next.category);
    if (next.source && next.source !== "all") p.set("source", next.source);
    if (next.manifest && next.manifest !== "all") p.set("manifest", next.manifest);
    if (next.language && next.language !== "all") p.set("language", next.language);
    if (next.sort && next.sort !== "relevance") p.set("sort", next.sort);
    const lang = (global.DSHI18n && DSHI18n.locale) || new URLSearchParams(location.search).get("lang");
    if (lang === "en" || lang === "zh") p.set("lang", lang);
    const qs = p.toString();
    const url = location.pathname + (qs ? "?" + qs : "") + location.hash;
    history.replaceState(null, "", url);
  }

  global.DSH = {
    loadCatalog: loadCatalog,
    getCatalog: getCatalog,
    plugins: plugins,
    categories: categories,
    stats: stats,
    desc: desc,
    descAll: descAll,
    categoryName: categoryName,
    sourceLabel: sourceLabel,
    manifestKey: manifestKey,
    manifestLabel: manifestLabel,
    manifestPillClass: manifestPillClass,
    patchLabel: patchLabel,
    installationLabel: installationLabel,
    findPlugin: findPlugin,
    formatNum: formatNum,
    relTime: relTime,
    formatDate: formatDate,
    escapeHtml: escapeHtml,
    avatarHtml: avatarHtml,
    readQuery: readQuery,
    writeQuery: writeQuery,
  };
})(window);
