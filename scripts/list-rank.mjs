// Load js/list-rank.js in a vm so deploy prep and the browser share one score.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../js/list-rank.js"), "utf8");

export function loadListRank() {
  const sandbox = {};
  vm.runInContext(code, vm.createContext(sandbox), { filename: "list-rank.js" });
  if (!sandbox.DSHListRank) throw new Error("js/list-rank.js did not set DSHListRank");
  return sandbox.DSHListRank;
}
