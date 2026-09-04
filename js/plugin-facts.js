/* Hydrate first-screen catalog facts from plugins.json. Never invent numbers. */
(function () {
  var root = document.querySelector("[data-plugin-facts]");
  if (!root) return;

  var id = root.getAttribute("data-plugin-id");
  if (!id) return;

  var MANIFEST = {
    zh: {
      shape_validated: "格式检查通过",
      not_checked: "未检查",
      not_validated: "缺少有效 dsh.bundle",
    },
    en: {
      shape_validated: "Shape validated",
      not_checked: "Not checked",
      not_validated: "Missing a valid dsh.bundle",
    },
  };

  function locale() {
    return (window.DSHI18n && DSHI18n.locale) || "zh";
  }

  function unchecked() {
    return locale() === "en" ? "Not checked" : "未检查";
  }

  function unavailable() {
    return locale() === "en" ? "n/a" : "暂无";
  }

  function formatDate(iso) {
    if (!iso) return unavailable();
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      var raw = String(iso);
      return raw.length >= 10 ? raw.slice(0, 10) : unavailable();
    }
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function set(sel, value) {
    var el = root.querySelector(sel);
    if (el) el.textContent = value;
  }

  function pluginVersion(plugin) {
    if (!plugin) return "";
    if (plugin.version) return String(plugin.version);
    if (plugin.latestVersion) return String(plugin.latestVersion);
    return "";
  }

  function fill(plugin) {
    var table = MANIFEST[locale()] || MANIFEST.zh;
    var key = plugin && plugin.verification && plugin.verification.manifest;
    set("[data-fact='manifest']", (key && table[key]) || unchecked());

    var ver = pluginVersion(plugin);
    set("[data-fact='version']", ver || unavailable());

    if (plugin && plugin.stars != null && plugin.stars !== "") {
      var n = Number(plugin.stars);
      set("[data-fact='stars']", Number.isFinite(n) ? n.toLocaleString("en-US") : unavailable());
    } else {
      set("[data-fact='stars']", unavailable());
    }

    set("[data-fact='updated']", plugin && plugin.pushedAt ? formatDate(plugin.pushedAt) : unavailable());
  }

  fetch("/data/plugins.json")
    .then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then(function (data) {
      var list = (data && data.plugins) || [];
      var plugin = list.find(function (p) {
        return p.id === id;
      });
      fill(plugin || null);
    })
    .catch(function () {
      /* keep HTML fallbacks from the last known catalog snapshot */
    });
})();
