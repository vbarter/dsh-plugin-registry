/* Shared homepage ranking. prepare-pages-deploy.mjs loads this file so the
 * static default pages use the same empty-query score as js/list.js. */
(function (root) {
  var PAGE_SIZE = 60;
  var DAY = 1000 * 60 * 60 * 24;

  function manifestKey(plugin) {
    return (plugin && plugin.verification && plugin.verification.manifest) || "not_checked";
  }

  function descAll(plugin) {
    var d = plugin && plugin.description;
    if (!d) return "";
    if (typeof d === "string") return d;
    return [d.zh, d.en].filter(Boolean).join(" ");
  }

  function atOf(now) {
    return typeof now === "number" ? now : Date.now();
  }

  // Mirrors js/list.js score() before this helper existed.
  // Empty q: stars*2 + forks*0.2 + 180 if shape_validated + 40 if curated
  // + recency bonus from pushedAt over a 90-day window.
  function relevanceScore(plugin, q, now) {
    var at = atOf(now);
    if (!q) {
      var s = (plugin.stars || 0) * 2 + (plugin.forks || 0) * 0.2;
      if (manifestKey(plugin) === "shape_validated") s += 180;
      if (plugin.source === "curated") s += 40;
      var pushed = Date.parse(plugin.pushedAt || "") || 0;
      s += Math.max(0, (pushed - at + DAY * 90) / DAY);
      return s;
    }
    var name = (plugin.name || "").toLowerCase();
    var owner = (plugin.owner || "").toLowerCase();
    var id = (plugin.id || "").toLowerCase();
    var text = descAll(plugin).toLowerCase();
    var topics = (plugin.topics || []).join(" ").toLowerCase();
    var query = String(q);
    var score = 0;
    if (name === query) score += 120;
    if (name.indexOf(query) !== -1) score += 48;
    if (owner.indexOf(query) !== -1) score += 24;
    if (id.indexOf(query) !== -1) score += 20;
    if (text.indexOf(query) !== -1) score += 16;
    if (topics.indexOf(query) !== -1) score += 12;
    score += Math.min(30, (plugin.stars || 0) / 80);
    return score;
  }

  function sortByRelevance(plugins, now) {
    var at = atOf(now);
    return plugins.slice().sort(function (a, b) {
      return relevanceScore(b, "", at) - relevanceScore(a, "", at);
    });
  }

  function buildListMeta(plugins, now) {
    var at = atOf(now);
    var stars = 0;
    var validated = 0;
    var owners = {};
    var counts = {};
    var langs = {};
    var installs = [];
    for (var i = 0; i < plugins.length; i++) {
      var p = plugins[i];
      stars += p.stars || 0;
      if (p.owner) owners[p.owner] = true;
      if (manifestKey(p) === "shape_validated") validated += 1;
      counts[p.category] = (counts[p.category] || 0) + 1;
      if (p.language) langs[p.language] = true;
      if (p.install && installs.length < 12) installs.push(p.install);
    }
    var languages = Object.keys(langs).sort(function (a, b) {
      return a.localeCompare(b);
    });
    var total = plugins.length;
    return {
      count: total,
      stars: stars,
      authors: Object.keys(owners).length,
      validated: validated,
      categoryCounts: counts,
      languages: languages,
      pageSize: PAGE_SIZE,
      total: total,
      totalPages: Math.ceil(total / PAGE_SIZE) || 0,
      installSamples: installs,
      sortedAt: new Date(at).toISOString(),
    };
  }

  function buildDefaultPages(plugins, now) {
    var at = atOf(now);
    var sorted = sortByRelevance(plugins, at);
    var total = sorted.length;
    var totalPages = Math.ceil(total / PAGE_SIZE) || 0;
    var pages = [];
    for (var i = 0; i < totalPages; i++) {
      pages.push({
        page: i + 1,
        pageSize: PAGE_SIZE,
        total: total,
        totalPages: totalPages,
        sort: "relevance",
        plugins: sorted.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE),
      });
    }
    return { pages: pages, pageSize: PAGE_SIZE, total: total, totalPages: totalPages, sortedAt: at };
  }

  function defaultPageFile(page) {
    var n = Number(page);
    if (!isFinite(n) || n < 1) n = 1;
    n = Math.floor(n);
    return "list-default-" + String(n).padStart(3, "0") + ".json";
  }

  root.DSHListRank = {
    PAGE_SIZE: PAGE_SIZE,
    manifestKey: manifestKey,
    descAll: descAll,
    relevanceScore: relevanceScore,
    sortByRelevance: sortByRelevance,
    buildListMeta: buildListMeta,
    buildDefaultPages: buildDefaultPages,
    defaultPageFile: defaultPageFile,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
