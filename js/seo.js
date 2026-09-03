/* JSON-LD, canonical, and social tags. SITE is the public origin. */
(function (global) {
  const SITE = "https://dsplugin.app";
  const PAGE_PATH = {
    index: "/",
    detail: "/plugin-detail.html",
    publish: "/publish",
    dashboard: "/dashboard",
    policy: "/policy",
  };
  const PAGE_NAME_KEY = {
    index: "nav.browse",
    detail: "title.detail",
    publish: "nav.publish",
    dashboard: "nav.stats",
    policy: "footer.policy",
  };

  function t(key, vars) {
    if (global.DSHI18n && typeof DSHI18n.t === "function") return DSHI18n.t(key, vars);
    return key;
  }

  function locale() {
    return (global.DSHI18n && DSHI18n.locale) || "zh";
  }

  function inLanguage() {
    return locale() === "en" ? "en" : "zh-CN";
  }

  function ogLocale() {
    return locale() === "en" ? "en_US" : "zh_CN";
  }

  function pageId() {
    return (document.body && document.body.getAttribute("data-page")) || "index";
  }

  function pluginIdFromUrl() {
    try {
      return new URLSearchParams(location.search).get("plugin") || "";
    } catch (e) {
      return "";
    }
  }

  function pluginUrl(id) {
    return SITE + "/plugin-detail.html?plugin=" + encodeURIComponent(id);
  }

  function pageUrl(id, extra) {
    const path = PAGE_PATH[id] || "/";
    const q = new URLSearchParams();
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        if (extra[k]) q.set(k, extra[k]);
      });
    }
    const qs = q.toString();
    return SITE + path + (qs ? "?" + qs : "");
  }

  function ensureMeta(attr, key) {
    let el = document.head.querySelector("meta[" + attr + '="' + key + '"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    return el;
  }

  function setMeta(attr, key, value) {
    if (value == null) return;
    ensureMeta(attr, key).setAttribute("content", value);
  }

  function ensureLink(rel, hreflang) {
    let sel = 'link[rel="' + rel + '"]';
    if (hreflang) sel += '[hreflang="' + hreflang + '"]';
    let el = document.head.querySelector(sel);
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", rel);
      if (hreflang) el.setAttribute("hreflang", hreflang);
      document.head.appendChild(el);
    }
    return el;
  }

  function setCanonical(url) {
    ensureLink("canonical").setAttribute("href", url);
    setMeta("property", "og:url", url);
  }

  function setHreflang(id, pluginId) {
    const extra = pluginId ? { plugin: pluginId } : null;
    const def = extra ? pageUrl(id, { plugin: pluginId }) : pageUrl(id);
    document.head.querySelectorAll('link[rel="alternate"][hreflang="zh-CN"], link[rel="alternate"][hreflang="en"]').forEach(function (el) {
      el.parentNode.removeChild(el);
    });
    ensureLink("alternate", "x-default").setAttribute("href", def);
  }

  function clip(text, max) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length <= max) return s;
    return s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  }

  function descOf(plugin) {
    if (global.DSH && typeof DSH.desc === "function") return DSH.desc(plugin) || "";
    const d = plugin && plugin.description;
    if (!d) return "";
    if (typeof d === "string") return d;
    const loc = locale();
    return d[loc] || d.zh || d.en || "";
  }

  function faqs() {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) {
      return { q: t("faq.q" + n), a: t("faq.a" + n) };
    });
  }

  function writeJsonLd(graph) {
    let el = document.getElementById("seo-jsonld");
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = "seo-jsonld";
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": graph,
    });
  }

  function baseGraph(id, plugin) {
    const lang = inLanguage();
    const canonical = plugin
      ? pluginUrl(plugin.id)
      : id === "detail" && pluginIdFromUrl()
        ? pluginUrl(pluginIdFromUrl())
        : pageUrl(id);
    const graph = [
      {
        "@type": "Organization",
        "@id": SITE + "/#org",
        name: "dsplugin.app",
        url: SITE + "/",
      },
      {
        "@type": "WebSite",
        "@id": SITE + "/#website",
        name: "dsplugin.app",
        url: SITE + "/",
        inLanguage: lang,
        description: t("meta.index"),
        publisher: { "@id": SITE + "/#org" },
      },
    ];

    const crumbs = [
      { "@type": "ListItem", position: 1, name: "dsplugin.app", item: SITE + "/" },
    ];
    if (id !== "index") {
      crumbs.push({
        "@type": "ListItem",
        position: 2,
        name: plugin ? plugin.name : t(PAGE_NAME_KEY[id] || "title." + id),
        item: canonical,
      });
    }
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: crumbs,
    });

    if (id === "index" || id === "policy") {
      graph.push({
        "@type": "FAQPage",
        mainEntity: faqs().map(function (item) {
          return {
            "@type": "Question",
            name: item.q,
            acceptedAnswer: { "@type": "Answer", text: item.a },
          };
        }),
      });
    }

    if (id === "publish") {
      graph.push({
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: t("publish.faq.q1"),
            acceptedAnswer: { "@type": "Answer", text: t("publish.faq.a1") },
          },
        ],
      });
    }

    return { graph: graph, canonical: canonical };
  }

  function applySocial(title, description, canonical) {
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:site_name", "dsplugin.app");
    setMeta("property", "og:locale", ogLocale());
    setMeta("property", "og:image", SITE + "/og.svg");
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
  }

  function applyDetail(plugin, built) {
    const name = plugin.name || plugin.id;
    const desc = clip(descOf(plugin), 155) || t("meta.detail");
    const title = t("title.detailPlugin", { name: name });
    const description = t("meta.detailPlugin", { name: name, desc: desc });
    applySocial(title, clip(description, 200), built.canonical);
    setCanonical(built.canonical);
    setHreflang("detail", plugin.id);

    const entity = {
      "@type": ["SoftwareApplication", "SoftwareSourceCode"],
      name: name,
      description: descOf(plugin) || desc,
      url: built.canonical,
      codeRepository: plugin.url || undefined,
      inLanguage: inLanguage(),
    };
    if (plugin.language) entity.programmingLanguage = plugin.language;
    if (plugin.install) entity.installUrl = built.canonical;
    if (plugin.category && global.DSH && DSH.categoryName) {
      entity.applicationCategory = DSH.categoryName(plugin.category);
    }
    built.graph.push(entity);
  }

  function applyIndexList(built) {
    if (!global.DSH || typeof DSH.plugins !== "function") return;
    const list = DSH.plugins().slice(0, 20);
    if (!list.length) return;
    built.graph.push({
      "@type": "ItemList",
      name: t("index.sectionTitle"),
      numberOfItems: list.length,
      itemListElement: list.map(function (plugin, i) {
        return {
          "@type": "ListItem",
          position: i + 1,
          name: plugin.name,
          url: pluginUrl(plugin.id),
          description: clip(descOf(plugin), 180),
        };
      }),
    });
  }

  function refresh() {
    const id = pageId();
    const pluginId = id === "detail" ? pluginIdFromUrl() : "";
    const plugin = pluginId && global.DSH && DSH.findPlugin
      ? DSH.findPlugin(pluginId)
      : null;
    const built = baseGraph(id, plugin);

    if (plugin) {
      applyDetail(plugin, built);
    } else {
      const title = t("title." + id);
      const description = t("meta." + id);
      const canonical = id === "detail" && pluginId ? pluginUrl(pluginId) : pageUrl(id);
      applySocial(title, description, canonical);
      setCanonical(canonical);
      setHreflang(id, pluginId);
    }

    if (id === "index") applyIndexList(built);
    writeJsonLd(built.graph);
  }

  function boot() {
    refresh();
    if (global.DSH && typeof DSH.loadCatalog === "function") {
      DSH.loadCatalog().then(refresh).catch(function () {});
    }
  }

  document.addEventListener("dsh-locale-change", refresh);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
