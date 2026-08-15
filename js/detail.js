/* Plugin detail page + install-steps modal. */
(function () {
  function t(key, vars) {
    return (window.DSHI18n && DSHI18n.t(key, vars)) || key;
  }

  let currentPlugin = null;
  let bound = false;

  function missing(root) {
    root.innerHTML =
      '<div class="empty-state rise">' +
      "<h1>" + DSH.escapeHtml(t("detail.missingTitle")) + "</h1>" +
      "<p>" + DSH.escapeHtml(t("detail.missingBody")) + "</p>" +
      '<a class="btn btn-primary" href="index.html">' + DSH.escapeHtml(t("detail.backList")) + "</a>" +
      "</div>";
  }

  function evidenceCopy(plugin) {
    const m = DSH.manifestKey(plugin);
    if (m === "shape_validated") {
      return { title: t("detail.evOk.title"), body: t("detail.evOk.body") };
    }
    if (m === "not_validated") {
      return { title: t("detail.evBad.title"), body: t("detail.evBad.body") };
    }
    return { title: t("detail.evSkip.title"), body: t("detail.evSkip.body") };
  }

  function related(plugin) {
    return DSH.plugins()
      .filter(function (p) { return p.id !== plugin.id && p.category === plugin.category; })
      .sort(function (a, b) { return (b.stars || 0) - (a.stars || 0); })
      .slice(0, 5);
  }

  function fill(plugin) {
    currentPlugin = plugin;
    document.title = plugin.name + " — DeepSeek Harness Plugin Registry";
    const avatar = document.getElementById("avatar-slot");
    avatar.innerHTML = DSH.avatarHtml(plugin, "lg");

    document.getElementById("plugin-name").textContent = plugin.name;
    const pills = document.getElementById("source-pill");
    pills.innerHTML =
      '<span class="pill pill-source">' + DSH.escapeHtml(DSH.sourceLabel(plugin)) + "</span>" +
      '<span class="' + DSH.manifestPillClass(plugin) + '">' + DSH.escapeHtml(DSH.manifestLabel(plugin)) + "</span>";

    document.getElementById("plugin-owner").textContent = plugin.owner || "—";
    const description = DSH.desc(plugin) || t("detail.noDesc");
    document.getElementById("plugin-desc").textContent = description;
    document.getElementById("readme-desc").textContent = description;

    document.getElementById("evidence-source").textContent = DSH.sourceLabel(plugin);
    document.getElementById("evidence-manifest").textContent = DSH.manifestLabel(plugin);
    document.getElementById("evidence-patch").textContent = DSH.patchLabel(plugin);
    document.getElementById("evidence-installation").textContent = DSH.installationLabel(plugin);

    const cmd = plugin.install || "";
    const cmdEl = document.getElementById("install-command");
    cmdEl.textContent = cmd || t("detail.noCmd");
    document.getElementById("modal-command").textContent = cmd || "—";

    const repoBtn = document.getElementById("repo-button");
    repoBtn.href = plugin.url || "#";

    document.getElementById("plugin-stars").textContent = DSH.formatNum(plugin.stars || 0);
    document.getElementById("plugin-forks").textContent = DSH.formatNum(plugin.forks || 0);
    document.getElementById("maintainer").textContent = plugin.owner || "—";
    document.getElementById("category").textContent = DSH.categoryName(plugin.category);
    document.getElementById("language-status").textContent = plugin.language || t("label.unspecified");
    document.getElementById("updated-status").textContent = DSH.formatDate(plugin.pushedAt);
    document.getElementById("updated-status").dateTime = plugin.pushedAt || "";
    document.getElementById("added-status").textContent = DSH.formatDate(plugin.addedAt);
    document.getElementById("added-status").dateTime = plugin.addedAt || "";
    document.getElementById("source").textContent = DSH.sourceLabel(plugin);
    document.getElementById("manifest-status").textContent = DSH.manifestLabel(plugin);
    document.getElementById("repo-link").href = plugin.url || "#";

    const decision = document.getElementById("manifest-decision");
    if (DSH.manifestKey(plugin) === "shape_validated") {
      decision.textContent = t("detail.decision.ok");
    } else if (DSH.manifestKey(plugin) === "not_validated") {
      decision.textContent = t("detail.decision.missing");
    } else {
      decision.textContent = t("detail.decision.unchecked");
    }

    const ev = evidenceCopy(plugin);
    document.getElementById("evidence-title").textContent = ev.title;
    document.getElementById("evidence-copy").textContent = ev.body;

    const topics = document.getElementById("topic-list");
    const topicList = plugin.topics || [];
    topics.innerHTML = topicList.length
      ? topicList.map(function (x) { return '<span class="topic-chip">#' + DSH.escapeHtml(x) + "</span>"; }).join("")
      : '<span class="topic-chip">' + DSH.escapeHtml(t("detail.noTopics")) + "</span>";

    const rel = related(plugin);
    const section = document.getElementById("related-section");
    const host = document.getElementById("related-list");
    if (rel.length) {
      section.hidden = false;
      host.innerHTML = rel
        .map(function (p) {
          return (
            '<a class="related-item" href="plugin-detail.html?plugin=' + encodeURIComponent(p.id) + '">' +
            "<span><b>" + DSH.escapeHtml(p.name) + "</b><small>" + DSH.escapeHtml(DSH.sourceLabel(p)) + " · " + DSH.escapeHtml(DSH.manifestLabel(p)) + "</small></span>" +
            "<strong>★ " + DSH.formatNum(p.stars || 0) + "</strong></a>"
          );
        })
        .join("");
    }

    if (bound) return;
    bound = true;

    const dialog = document.getElementById("install-dialog");
    const openBtn = document.getElementById("install-btn");
    const closeBtn = document.getElementById("install-close");
    function openModal() {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      document.documentElement.classList.add("modal-open");
    }
    function closeModal() {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      document.documentElement.classList.remove("modal-open");
    }
    openBtn.addEventListener("click", openModal);
    closeBtn.addEventListener("click", closeModal);
    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("modal-open");
    });

    function onCopy() {
      DSHCommon.copyText(currentPlugin && currentPlugin.install).then(function (ok) {
        const status = document.getElementById("install-copy-status");
        const modalStatus = document.getElementById("modal-copy-status");
        const msg = ok ? t("toast.copiedCmd") : t("toast.copyFailCmd");
        if (status) status.textContent = msg;
        if (modalStatus) modalStatus.textContent = msg;
      });
    }
    document.getElementById("copy-btn").addEventListener("click", onCopy);
    document.getElementById("modal-copy").addEventListener("click", onCopy);
  }

  document.addEventListener("dsh-locale-change", function () {
    if (currentPlugin) fill(currentPlugin);
  });

  DSH.loadCatalog()
    .then(function () {
      const id = DSH.readQuery().plugin;
      const root = document.getElementById("detail-root");
      if (!id) {
        missing(root);
        return;
      }
      const plugin = DSH.findPlugin(id);
      if (!plugin) {
        missing(root);
        return;
      }
      fill(plugin);
    })
    .catch(function (err) {
      document.getElementById("detail-root").innerHTML =
        '<div class="empty-state"><h1>' + DSH.escapeHtml(t("detail.loadFail")) + "</h1><p>" + DSH.escapeHtml(err.message || String(err)) + "</p></div>";
    });
})();
