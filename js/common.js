/* Shared chrome helpers: clipboard toasts, count-up, ⌘K, reduced motion, registry repo. */
(function (global) {
  global.REGISTRY_REPO = "vbarter/dsh-plugin-registry";

  function t(key, vars) {
    if (global.DSHI18n && typeof DSHI18n.t === "function") return DSHI18n.t(key, vars);
    return key;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function toast(message) {
    let el = document.getElementById("site-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "site-toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._hide);
    el._hide = setTimeout(function () {
      el.classList.remove("show");
    }, 1800);
  }

  function copyText(text) {
    const value = String(text || "");
    if (!value) {
      toast(t("toast.empty"));
      return Promise.resolve(false);
    }
    const done = function () {
      toast(t("toast.copied"));
      return true;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(done).catch(function () {
        return fallbackCopy(value);
      });
    }
    return Promise.resolve(fallbackCopy(value));
  }

  function fallbackCopy(value) {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (ok) toast(t("toast.copied"));
    else toast(t("toast.copyFail"));
    return ok;
  }

  function countUp(el, target, duration) {
    if (!el) return;
    const end = Number(target) || 0;
    if (prefersReducedMotion() || end <= 0) {
      el.textContent = DSH.formatNum(end);
      return;
    }
    const start = performance.now();
    const ms = duration || 800;
    function frame(now) {
      const tnow = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - tnow, 3);
      el.textContent = DSH.formatNum(Math.round(end * eased));
      if (tnow < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function bindSearchHotkey(input) {
    if (!input) return;
    document.addEventListener("keydown", function (ev) {
      const meta = ev.metaKey || ev.ctrlKey;
      if (meta && (ev.key === "k" || ev.key === "K")) {
        ev.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  function starSvg() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.2l2.4 5.1 5.6.8-4 3.9.9 5.6L12 16l-4.9 2.6.9-5.6-4-3.9 5.6-.8z"/></svg>';
  }

  function forkSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M7 4v7a5 5 0 005 5h0a5 5 0 005-5V4M7 20a2 2 0 100-4 2 2 0 000 4zM17 20a2 2 0 100-4 2 2 0 000 4zM7 4a2 2 0 100-4 2 2 0 000 4zM17 4a2 2 0 100-4 2 2 0 000 4z" transform="translate(0 2)"/></svg>';
  }

  function applyRegistryLinks(repo) {
    if (!repo) return;
    document.querySelectorAll("[data-registry-href]").forEach(function (el) {
      const kind = el.getAttribute("data-registry-href");
      if (kind === "issues") el.href = "https://github.com/" + repo + "/issues";
      if (kind === "issue-new") {
        el.href = "https://github.com/" + repo + "/issues/new?template=plugin_submission.yml";
      }
    });
  }

  function loadConfig() {
    return fetch("data/config.json")
      .then(function (res) {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then(function (cfg) {
        if (cfg && cfg.repo) global.REGISTRY_REPO = cfg.repo;
        applyRegistryLinks(global.REGISTRY_REPO);
        document.dispatchEvent(new CustomEvent("dsh-config-ready", { detail: cfg }));
        return cfg;
      })
      .catch(function () {
        applyRegistryLinks(global.REGISTRY_REPO);
        return { repo: global.REGISTRY_REPO };
      });
  }

  applyRegistryLinks(global.REGISTRY_REPO);
  loadConfig();

  global.DSHCommon = {
    prefersReducedMotion: prefersReducedMotion,
    toast: toast,
    copyText: copyText,
    countUp: countUp,
    bindSearchHotkey: bindSearchHotkey,
    starSvg: starSvg,
    forkSvg: forkSvg,
    loadConfig: loadConfig,
    applyRegistryLinks: applyRegistryLinks,
  };
})(window);
