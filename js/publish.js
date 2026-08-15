/* Publish flow: local shape checks + optional GitHub API, then open a prefilled Issue. */
(function () {
  function t(key, vars) {
    return (window.DSHI18n && DSHI18n.t(key, vars)) || key;
  }

  function registryRepo() {
    return window.REGISTRY_REPO || "vbarter/dsh-plugin-registry";
  }

  function issueNewUrl() {
    return "https://github.com/" + registryRepo() + "/issues/new";
  }

  function issueListUrl() {
    return "https://github.com/" + registryRepo() + "/issues";
  }

  const form = document.getElementById("repo-checker-form");
  const input = document.getElementById("repo-input");
  const results = document.getElementById("check-results");
  const message = document.getElementById("check-message");
  const submit = document.getElementById("github-submit");
  const help = document.getElementById("submission-help");
  const steps = document.querySelectorAll(".step");

  let lastCheck = null;

  function parseRepo(raw) {
    const text = String(raw || "").trim();
    if (!text) return { error: t("publish.emptyRepo") };
    let owner = "";
    let repo = "";
    const url = text.match(/^https?:\/\/github\.com\/([^/#?\s]+)\/([^/#?\s]+)/i);
    const short = text.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (url) {
      owner = url[1];
      repo = url[2].replace(/\.git$/i, "");
    } else if (short) {
      owner = short[1];
      repo = short[2].replace(/\.git$/i, "");
    } else {
      return { error: t("publish.badUrl") };
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      return { error: t("publish.badChars") };
    }
    if (owner === "." || repo === "." || owner === ".." || repo === "..") {
      return { error: t("publish.badPath") };
    }
    return {
      owner: owner,
      repo: repo,
      slug: owner + "/" + repo,
      url: "https://github.com/" + owner + "/" + repo,
    };
  }

  function setRow(key, status, label) {
    const row = results.querySelector('[data-check="' + key + '"]');
    if (!row) return;
    row.classList.remove("ok", "fail", "warn");
    if (status) row.classList.add(status);
    const ic = row.querySelector(".check-ic");
    const state = row.querySelector(".check-state");
    ic.textContent = status === "ok" ? "✓" : status === "fail" ? "✕" : status === "warn" ? "!" : "—";
    state.textContent = label;
  }

  function markStep(n) {
    steps.forEach(function (el, i) {
      el.classList.toggle("on", i === n);
    });
  }

  function issueUrl(parsed, rows, note) {
    const title = "[plugin] " + parsed.slug;
    const lines = [
      "## " + t("publish.issueRepo"),
      parsed.url,
      "",
      "### owner/repo",
      parsed.slug,
      "",
      "## " + t("publish.issueChecks"),
    ];
    rows.forEach(function (r) {
      lines.push("- " + r.label + "：" + r.state);
    });
    lines.push("");
    lines.push("## " + t("publish.issueNotes"));
    lines.push(note || t("publish.noteRemote"));
    lines.push("");
    lines.push(t("publish.issueFooter"));
    return (
      issueNewUrl() +
      "?template=plugin_submission.yml" +
      "&title=" + encodeURIComponent(title) +
      "&body=" + encodeURIComponent(lines.join("\n"))
    );
  }

  function enableSubmit(href, hint) {
    submit.href = href;
    submit.classList.remove("is-disabled");
    submit.setAttribute("aria-disabled", "false");
    help.textContent = hint;
    markStep(1);
  }

  async function fetchJson(url, headers) {
    const res = await fetch(url, { headers: headers || {} });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function runCheck(ev) {
    ev.preventDefault();
    const parsed = parseRepo(input.value);
    results.hidden = false;
    markStep(0);
    submit.classList.add("is-disabled");
    submit.setAttribute("aria-disabled", "true");
    submit.removeAttribute("href");

    if (parsed.error) {
      setRow("repo", "fail", parsed.error);
      setRow("topic", "warn", t("publish.unchecked"));
      setRow("bundle", "warn", t("publish.unchecked"));
      setRow("status", "warn", t("publish.unchecked"));
      message.textContent = parsed.error;
      lastCheck = null;
      return;
    }

    setRow("repo", "", t("publish.checking"));
    setRow("topic", "", t("publish.checking"));
    setRow("bundle", "", t("publish.checking"));
    setRow("status", "", t("publish.checking"));
    message.textContent = t("publish.checkingSlug", { slug: parsed.slug });

    const rows = [];
    let remote = false;
    let meta = null;
    let pkg = null;

    try {
      meta = await fetchJson("https://api.github.com/repos/" + parsed.owner + "/" + parsed.repo, {
        Accept: "application/vnd.github+json",
      });
      remote = true;
    } catch (err) {
      remote = false;
    }

    if (remote && meta) {
      const publicOk = !meta.private && !meta.message;
      setRow("repo", publicOk ? "ok" : "fail", publicOk ? t("publish.repoOk") : t("publish.repoFail"));
      rows.push({ label: t("publish.check.repo"), state: publicOk ? t("publish.pass") : t("publish.fail") });

      const topics = meta.topics || [];
      const hasTopic = topics.indexOf("dsh-plugin") !== -1;
      setRow("topic", hasTopic ? "ok" : "fail", hasTopic ? t("publish.topicOk") : t("publish.topicFail"));
      rows.push({ label: t("publish.check.topic"), state: hasTopic ? t("publish.pass") : t("publish.fail") });

      const archived = !!meta.archived;
      const fork = !!meta.fork;
      const statusOk = !archived && !fork;
      setRow("status", statusOk ? "ok" : "fail", statusOk ? t("publish.statusOk") : (archived ? t("publish.archived") : t("publish.isFork")));
      rows.push({ label: t("publish.check.status"), state: statusOk ? t("publish.pass") : t("publish.fail") });
    } else {
      setRow("repo", "ok", t("publish.localRepo"));
      setRow("topic", "warn", t("publish.topicWarn"));
      setRow("status", "warn", t("publish.statusWarn"));
      rows.push({ label: t("publish.check.repo"), state: t("publish.localShape") });
      rows.push({ label: t("publish.check.topic"), state: t("publish.remoteFail") });
      rows.push({ label: t("publish.check.status"), state: t("publish.remoteFail") });
    }

    try {
      const branch = (meta && (meta.default_branch || "main")) || "HEAD";
      pkg = await fetchJson("https://raw.githubusercontent.com/" + parsed.owner + "/" + parsed.repo + "/" + branch + "/package.json");
    } catch (err) {
      try {
        pkg = await fetchJson("https://raw.githubusercontent.com/" + parsed.owner + "/" + parsed.repo + "/HEAD/package.json");
      } catch (err2) {
        pkg = null;
      }
    }

    if (pkg && pkg.dsh && pkg.dsh.bundle && typeof pkg.dsh.bundle.patch === "string") {
      const patch = pkg.dsh.bundle.patch;
      const safe = !patch.startsWith("/") && patch.indexOf("..") === -1;
      setRow("bundle", safe ? "ok" : "fail", safe ? t("publish.bundleOk") : t("publish.bundleUnsafe"));
      rows.push({
        label: t("publish.check.bundle"),
        state: safe ? t("publish.pass") + "（" + patch + "）" : t("publish.fail") + "：" + patch,
      });
    } else if (pkg) {
      setRow("bundle", "fail", t("publish.bundleMissing"));
      rows.push({ label: t("publish.check.bundle"), state: t("publish.fail") });
    } else {
      setRow("bundle", "warn", t("publish.bundleUnread"));
      rows.push({ label: t("publish.check.bundle"), state: t("publish.remoteFail") });
    }

    const note = remote ? t("publish.noteRemote") : t("publish.noteLocal");
    message.textContent = remote ? t("publish.doneRemote") : t("publish.doneLocal");

    const href = issueUrl(parsed, rows, note);
    lastCheck = { parsed: parsed, rows: rows, href: href };
    enableSubmit(href, t("publish.enableHint"));
  }

  form.addEventListener("submit", function (ev) {
    runCheck(ev).catch(function (err) {
      message.textContent = t("publish.checkError", { error: err.message || String(err) });
    });
  });

  submit.addEventListener("click", function (ev) {
    if (submit.classList.contains("is-disabled")) {
      ev.preventDefault();
      message.textContent = t("publish.checkFirst");
      return;
    }
    markStep(2);
    if (!submit.href) {
      ev.preventDefault();
      help.textContent = t("publish.manualIssue", { url: issueListUrl() });
    }
  });

  document.addEventListener("dsh-locale-change", function () {
    if (lastCheck) {
      const href = issueUrl(lastCheck.parsed, lastCheck.rows, lastCheck.note);
      lastCheck.href = href;
      if (!submit.classList.contains("is-disabled")) {
        submit.href = href;
        help.textContent = t("publish.enableHint");
      }
    }
  });
})();
