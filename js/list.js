/* Browse page: search, filters, URL sync, infinite-ish load more, terminal typer. */
(function () {
  const PAGE = 60;
  const state = {
    q: "",
    category: "all",
    source: "all",
    manifest: "all",
    language: "all",
    sort: "relevance",
    shown: PAGE,
  };

  let filtered = [];

  function t(key, vars) {
    return (window.DSHI18n && DSHI18n.t(key, vars)) || key;
  }

  function haystack(plugin) {
    const bits = [
      plugin.name,
      plugin.owner,
      plugin.id,
      DSH.descAll ? DSH.descAll(plugin) : DSH.desc(plugin),
      plugin.language,
      (plugin.topics || []).join(" "),
    ];
    return bits.join(" ").toLowerCase();
  }

  function score(plugin, q) {
    if (!q) {
      let s = (plugin.stars || 0) * 2 + (plugin.forks || 0) * 0.2;
      if (DSH.manifestKey(plugin) === "shape_validated") s += 180;
      if (plugin.source === "curated") s += 40;
      const pushed = Date.parse(plugin.pushedAt || "") || 0;
      s += Math.max(0, (pushed - Date.now() + 1000 * 60 * 60 * 24 * 90) / (1000 * 60 * 60 * 24));
      return s;
    }
    const name = (plugin.name || "").toLowerCase();
    const owner = (plugin.owner || "").toLowerCase();
    const id = (plugin.id || "").toLowerCase();
    const text = (DSH.descAll ? DSH.descAll(plugin) : DSH.desc(plugin)).toLowerCase();
    const topics = (plugin.topics || []).join(" ").toLowerCase();
    let s = 0;
    if (name === q) s += 120;
    if (name.includes(q)) s += 48;
    if (owner.includes(q)) s += 24;
    if (id.includes(q)) s += 20;
    if (text.includes(q)) s += 16;
    if (topics.includes(q)) s += 12;
    s += Math.min(30, (plugin.stars || 0) / 80);
    return s;
  }

  function applyFilters() {
    const q = state.q.trim().toLowerCase();
    const all = DSH.plugins();
    filtered = all.filter(function (p) {
      if (state.category !== "all" && p.category !== state.category) return false;
      if (state.source !== "all" && p.source !== state.source) return false;
      if (state.manifest !== "all" && DSH.manifestKey(p) !== state.manifest) return false;
      if (state.language !== "all" && (p.language || "") !== state.language) return false;
      if (q && haystack(p).indexOf(q) === -1) return false;
      return true;
    });

    const sort = state.sort;
    filtered.sort(function (a, b) {
      if (sort === "stars") return (b.stars || 0) - (a.stars || 0);
      if (sort === "forks") return (b.forks || 0) - (a.forks || 0);
      if (sort === "new") return Date.parse(b.pushedAt || 0) - Date.parse(a.pushedAt || 0);
      if (sort === "added") return String(b.addedAt || "").localeCompare(String(a.addedAt || ""));
      if (sort === "manifest") {
        const av = DSH.manifestKey(a) === "shape_validated" ? 1 : 0;
        const bv = DSH.manifestKey(b) === "shape_validated" ? 1 : 0;
        if (bv !== av) return bv - av;
        return (b.stars || 0) - (a.stars || 0);
      }
      return score(b, q) - score(a, q);
    });
  }

  function topicBits(plugin) {
    const topics = (plugin.topics || []).filter(function (topic) {
      return topic && topic !== "dsh-plugin" && topic !== "dsh";
    }).slice(0, 3);
    return topics
      .map(function (topic) {
        return '<span class="prow-topic">#' + DSH.escapeHtml(topic) + "</span>";
      })
      .join("");
  }

  function rowHtml(plugin, index) {
    const pending = DSH.manifestKey(plugin) === "not_validated";
    const href = "plugin-detail.html?plugin=" + encodeURIComponent(plugin.id);
    const idx = String(index + 1).padStart(2, "0");
    return (
      '<article class="prow' + (pending ? " prow-pending" : "") + '">' +
      '<div class="prow-idx">' + idx + "</div>" +
      '<a href="' + href + '" aria-hidden="true">' + DSH.avatarHtml(plugin) + "</a>" +
      '<div class="prow-main">' +
      '<div class="prow-name"><a href="' + href + '">' + DSH.escapeHtml(plugin.name) + "</a></div>" +
      '<p class="prow-desc">' + DSH.escapeHtml(DSH.desc(plugin) || t("index.noDesc")) + "</p>" +
      '<div class="prow-signals">' +
      '<span class="pill pill-source">' + DSH.escapeHtml(DSH.sourceLabel(plugin)) + "</span>" +
      '<span class="' + DSH.manifestPillClass(plugin) + '">' + DSH.escapeHtml(DSH.manifestLabel(plugin)) + "</span>" +
      topicBits(plugin) +
      '<time class="prow-updated">' + DSH.escapeHtml(DSH.relTime(plugin.pushedAt)) + "</time>" +
      "</div></div>" +
      '<div class="prow-stars">' + DSHCommon.starSvg() + "<span>" + DSH.formatNum(plugin.stars || 0) + "</span><small>Stars</small></div>" +
      '<div class="prow-forks">' + DSHCommon.forkSvg() + "<span>" + DSH.formatNum(plugin.forks || 0) + "</span><small>Forks</small></div>" +
      '<div class="prow-act"><a class="btn btn-sm btn-repository" href="' + DSH.escapeHtml(plugin.url) + '" target="_blank" rel="noopener">' + DSH.escapeHtml(t("index.viewRepo")) + "</a></div>" +
      "</article>"
    );
  }

  function renderList() {
    const list = document.getElementById("list");
    const note = document.getElementById("list-note");
    const moreWrap = document.getElementById("load-more-wrap");
    const slice = filtered.slice(0, state.shown);
    if (!filtered.length) {
      list.innerHTML = '<div class="prow-empty">' + DSH.escapeHtml(t("index.empty")) + "</div>";
      note.textContent = t("index.listNoteZero");
      moreWrap.hidden = true;
      return;
    }
    list.innerHTML = slice.map(rowHtml).join("");
    note.textContent = t("index.listNote", { shown: slice.length, total: filtered.length });
    moreWrap.hidden = slice.length >= filtered.length;
  }

  function syncControls() {
    const q = document.getElementById("q");
    if (q && q.value !== state.q) q.value = state.q;
    document.querySelectorAll(".chip[data-cat]").forEach(function (btn) {
      btn.classList.toggle("on", btn.getAttribute("data-cat") === state.category);
    });
    ["source", "manifest", "language", "sort"].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.value = state[id];
    });
  }

  function refresh(resetPage) {
    if (resetPage) state.shown = PAGE;
    applyFilters();
    syncControls();
    DSH.writeQuery(state);
    renderList();
  }

  function updateChipLabels() {
    const host = document.getElementById("chips");
    if (!host) return;
    host.querySelectorAll(".chip[data-cat]").forEach(function (btn) {
      const key = btn.getAttribute("data-cat");
      const count = btn.querySelector(".chip-count");
      const countHtml = count ? count.outerHTML : "";
      const label = key === "all" ? t("index.filter.all") : DSH.categoryName(key);
      btn.innerHTML = DSH.escapeHtml(label) + " " + countHtml;
    });
  }

  function buildChips() {
    const host = document.getElementById("chips");
    const cats = DSH.categories();
    const counts = {};
    DSH.plugins().forEach(function (p) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    });
    const allBtn = host.querySelector('[data-cat="all"]');
    if (allBtn) {
      const span = allBtn.querySelector(".chip-count");
      if (span) span.textContent = DSH.formatNum(DSH.plugins().length);
    }
    Object.keys(cats).forEach(function (key) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.setAttribute("data-cat", key);
      btn.innerHTML =
        DSH.escapeHtml(DSH.categoryName(key)) +
        ' <span class="chip-count">' +
        DSH.formatNum(counts[key] || 0) +
        "</span>";
      host.appendChild(btn);
    });
  }

  function buildLanguages() {
    const sel = document.getElementById("language");
    const set = {};
    DSH.plugins().forEach(function (p) {
      if (p.language) set[p.language] = true;
    });
    Object.keys(set)
      .sort(function (a, b) {
        return a.localeCompare(b);
      })
      .forEach(function (lang) {
        const opt = document.createElement("option");
        opt.value = lang;
        opt.textContent = lang;
        sel.appendChild(opt);
      });
  }

  function fillStats() {
    const list = DSH.plugins();
    const stars = list.reduce(function (s, p) { return s + (p.stars || 0); }, 0);
    const owners = {};
    let validated = 0;
    list.forEach(function (p) {
      if (p.owner) owners[p.owner] = true;
      if (DSH.manifestKey(p) === "shape_validated") validated += 1;
    });
    DSHCommon.countUp(document.getElementById("st-count"), list.length);
    DSHCommon.countUp(document.getElementById("st-stars"), stars);
    DSHCommon.countUp(document.getElementById("st-author"), Object.keys(owners).length);
    DSHCommon.countUp(document.getElementById("st-auto"), validated);
  }

  function startTyper() {
    const el = document.getElementById("typer");
    if (!el) return;
    const cmds = DSH.plugins()
      .filter(function (p) { return p.install; })
      .slice(0, 12)
      .map(function (p) { return p.install; });
    if (!cmds.length) {
      el.textContent = "dsh plugin --profile web add github:owner/repo";
      return;
    }
    if (DSHCommon.prefersReducedMotion()) {
      el.textContent = cmds[0];
      return;
    }
    let i = 0;
    let pos = 0;
    let deleting = false;
    function tick() {
      const cur = cmds[i % cmds.length];
      if (!deleting) {
        pos += 1;
        el.textContent = cur.slice(0, pos);
        if (pos >= cur.length) {
          deleting = true;
          setTimeout(tick, 1600);
          return;
        }
        setTimeout(tick, 28 + Math.random() * 36);
      } else {
        pos -= 1;
        el.textContent = cur.slice(0, pos);
        if (pos <= 0) {
          deleting = false;
          i += 1;
          setTimeout(tick, 320);
          return;
        }
        setTimeout(tick, 16);
      }
    }
    tick();
  }

  function hydrateFromUrl() {
    const q = DSH.readQuery();
    state.q = q.q;
    state.category = q.category;
    state.source = q.source;
    state.manifest = q.manifest;
    state.language = q.language;
    state.sort = q.sort || "relevance";
  }

  function bind() {
    const q = document.getElementById("q");
    DSHCommon.bindSearchHotkey(q);
    let timer = null;
    q.addEventListener("input", function () {
      state.q = q.value;
      clearTimeout(timer);
      timer = setTimeout(function () { refresh(true); }, 80);
    });

    document.getElementById("chips").addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-cat]");
      if (!btn) return;
      state.category = btn.getAttribute("data-cat");
      refresh(true);
    });

    document.querySelectorAll(".intent-row button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.q = btn.getAttribute("data-intent") || btn.textContent;
        refresh(true);
        q.focus();
      });
    });

    ["source", "manifest", "language", "sort"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", function (ev) {
        state[id] = ev.target.value;
        refresh(true);
      });
    });

    document.getElementById("load-more").addEventListener("click", function () {
      state.shown += PAGE;
      renderList();
    });

    document.addEventListener("dsh-locale-change", function () {
      updateChipLabels();
      renderList();
    });
  }

  DSH.loadCatalog()
    .then(function () {
      hydrateFromUrl();
      buildChips();
      buildLanguages();
      fillStats();
      startTyper();
      bind();
      refresh(true);
    })
    .catch(function (err) {
      document.getElementById("list").innerHTML =
        '<div class="prow-empty">' + DSH.escapeHtml(t("index.loadFail", { error: err.message || String(err) })) + "</div>";
    });
})();
