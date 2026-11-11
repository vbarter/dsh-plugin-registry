/**
 * Writer one-liners for /new list rows.
 *
 * Drop a sheet at scripts/new-blurbs/YYYY-MM-DD.md (same table as
 * 2026-11-11.md: plugin | 名称 | zh | en). The date file wins for that
 * addedAt day. NEW_PLUGIN_BLURBS is the undated plugin-id map and applies
 * on any other day. Display names stay the catalog name; the 名称 column
 * is not copied onto the page.
 *
 * zh is the Chinese page. en is the English page. Cells are used as written.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BLURB_DIR = join(dirname(fileURLToPath(import.meta.url)), "new-blurbs");

/** plugin id -> { zh, en }. Used when that id has no dated sheet. */
export const NEW_PLUGIN_BLURBS = {};

export function parseBlurbSheet(markdown) {
  const rows = {};
  const text = String(markdown).replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const id = cells[0];
    if (!id || id === "plugin" || /^:?-+:?$/.test(id)) continue;
    rows[id] = { zh: cells[2], en: cells[3] };
  }
  return rows;
}

export function loadBlurbSheets(dir = BLURB_DIR) {
  const byDate = {};
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return byDate;
  }
  for (const name of names) {
    const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
    if (!match) continue;
    byDate[match[1]] = parseBlurbSheet(readFileSync(join(dir, name), "utf8"));
  }
  return byDate;
}

export const NEW_PLUGIN_BLURBS_BY_DATE = loadBlurbSheets();

export function resolveWriterBlurb(pluginId, date, tables) {
  const byDate = (tables && tables.byDate) || NEW_PLUGIN_BLURBS_BY_DATE;
  const byId = (tables && tables.byId) || NEW_PLUGIN_BLURBS;
  if (pluginId && date && byDate[date] && byDate[date][pluginId]) return byDate[date][pluginId];
  if (pluginId && byId[pluginId]) return byId[pluginId];
  return null;
}
