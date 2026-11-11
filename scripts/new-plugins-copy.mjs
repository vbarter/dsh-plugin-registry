/**
 * Daily /new copy. Locked 2026-11-11 by Head of SEO and Content Writer.
 * Edit strings here. Routing lives in functions/_middleware.js.
 * Eligibility lives in scripts/new-plugins.mjs.
 */
export const NEW_PLUGIN_COPY = {
  zh: {
    title: "今日新增插件 · dsplugin.app",
    h1: "今日新增插件",
    intro(n) {
      return `今日新增 ${n} 款插件，按综合得分排序；点名称查看详情。`;
    },
    empty: "今日暂无符合规则的新增插件。",
  },
  en: {
    title: "Plugins added today · dsplugin.app",
    h1: "Plugins added today",
    intro(n) {
      return `${n} plugins added today, sorted by a combined score. Open a name for details.`;
    },
    empty: "No matching plugins were added today.",
  },
};

/** Between the linked name and the one-sentence purpose. */
export const NEW_PLUGIN_ROW_SEPARATOR = "：";
