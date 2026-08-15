/* Dashboard: KPIs, category bars, source mix, stars / author tables. */
(function () {
  function t(key, vars) {
    return (window.DSHI18n && DSHI18n.t(key, vars)) || key;
  }

  function barRows(host, items, nameKey) {
    const max = Math.max.apply(null, items.map(function (x) { return x.count; }).concat([1]));
    host.innerHTML = items
      .map(function (item, i) {
        const pct = Math.max(4, Math.round((item.count / max) * 100));
        return (
          '<div class="hbar-row">' +
          "<span>" + DSH.escapeHtml(item[nameKey]) + "</span>" +
          '<div class="hbar-track"><div class="hbar-fill" style="width:' + pct + '%;opacity:' + (i === 0 ? 1 : 0.55 + (1 - i / items.length) * 0.35) + '"></div></div>' +
          '<span class="hbar-n">' + DSH.formatNum(item.count) + "</span>" +
          "</div>"
        );
      })
      .join("");
  }

  function render(animate) {
    const list = DSH.plugins();
    const catalog = DSH.getCatalog();
    const stars = list.reduce(function (s, p) { return s + (p.stars || 0); }, 0);
    const owners = {};
    let validated = 0;
    const byCat = {};
    const bySource = { curated: 0, discovered: 0 };
    const byOwner = {};

    list.forEach(function (p) {
      if (p.owner) owners[p.owner] = true;
      if (DSH.manifestKey(p) === "shape_validated") validated += 1;
      byCat[p.category] = (byCat[p.category] || 0) + 1;
      if (p.source === "curated") bySource.curated += 1;
      else bySource.discovered += 1;
      if (!byOwner[p.owner]) byOwner[p.owner] = { owner: p.owner, count: 0, stars: 0 };
      byOwner[p.owner].count += 1;
      byOwner[p.owner].stars += p.stars || 0;
    });

    const published = (catalog.stats && catalog.stats.published) || list.length;
    if (animate) {
      DSHCommon.countUp(document.getElementById("k-stars"), stars);
      DSHCommon.countUp(document.getElementById("k-count"), published);
      DSHCommon.countUp(document.getElementById("k-author"), Object.keys(owners).length);
      DSHCommon.countUp(document.getElementById("k-auto"), validated);
    } else {
      document.getElementById("k-stars").textContent = DSH.formatNum(stars);
      document.getElementById("k-count").textContent = DSH.formatNum(published);
      document.getElementById("k-author").textContent = DSH.formatNum(Object.keys(owners).length);
      document.getElementById("k-auto").textContent = DSH.formatNum(validated);
    }

    const catItems = Object.keys(DSH.categories())
      .map(function (key) {
        return { name: DSH.categoryName(key), count: byCat[key] || 0 };
      })
      .sort(function (a, b) { return b.count - a.count; });
    barRows(document.getElementById("cats"), catItems, "name");

    const srcItems = [
      { name: t("label.source.curated"), count: bySource.curated },
      { name: t("label.source.discovered"), count: bySource.discovered },
    ];
    barRows(document.getElementById("sources"), srcItems, "name");

    const updated = document.getElementById("updated");
    if (catalog.generatedAt) {
      updated.textContent = t("dash.updated", {
        date: DSH.formatDate(catalog.generatedAt),
        ver: catalog.schemaVersion || "2",
      });
    }

    const top = list.slice().sort(function (a, b) { return (b.stars || 0) - (a.stars || 0); }).slice(0, 10);
    document.getElementById("top-rows").innerHTML = top
      .map(function (p, i) {
        return (
          "<tr><td>" + (i + 1) + '</td><td><a class="nm" href="plugin-detail.html?plugin=' +
          encodeURIComponent(p.id) + '">' + DSH.escapeHtml(p.name) + "</a></td>" +
          '<td class="r">' + DSH.formatNum(p.stars || 0) + "</td>" +
          '<td class="r">' + DSH.formatNum(p.forks || 0) + "</td></tr>"
        );
      })
      .join("");

    const authors = Object.keys(byOwner)
      .map(function (k) { return byOwner[k]; })
      .sort(function (a, b) { return b.stars - a.stars || b.count - a.count; })
      .slice(0, 10);
    document.getElementById("author-rows").innerHTML = authors
      .map(function (a) {
        return (
          "<tr><td class=\"nm\">" + DSH.escapeHtml(a.owner) + "</td>" +
          '<td class="r">' + DSH.formatNum(a.count) + "</td>" +
          '<td class="r">' + DSH.formatNum(a.stars) + "</td></tr>"
        );
      })
      .join("");
  }

  DSH.loadCatalog()
    .then(function () {
      render(true);
      document.addEventListener("dsh-locale-change", function () { render(false); });
    })
    .catch(function (err) {
      document.getElementById("k-count").textContent = "—";
      document.getElementById("updated").textContent = t("dash.loadFail", { error: err.message || String(err) });
    });
})();
