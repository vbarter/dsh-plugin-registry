# DeepSeek Harness Community Registry

社区插件注册表静态站。浏览、详情、发布、统计、收录规范五页，无构建步骤。站点数据就是提交在仓库里的 `data/plugins.json`（schemaVersion 2）。GitHub Actions 是官方后端：定时扫描 `dsh-plugin` topic，用户发布走 Issue → 预检 → 审核 PR。

**所有目录写入都走 GitHub PR**，不会直接推 `main`：用户提交（`submission/<n>`）、自动发现（`discover/sync`）、社区目录 Manifest 复核（`review/curated-manifest`）。维护者在 [Pull Requests](https://github.com/vbarter/dsh-plugin-registry/pulls) 合并后，站点数据才更新。

仓库：[`vbarter/dsh-plugin-registry`](https://github.com/vbarter/dsh-plugin-registry)

## 自动发现怎么工作

1. `.github/workflows/discover.yml` 每 2 小时（`20 */2 * * *`）或手动 `workflow_dispatch` 运行。
2. `scripts/discover.mjs` 调用 GitHub Search：`topic:dsh-plugin`，跟随 `Link` 分页。
3. 对每个仓库读取根目录 `package.json`。同时满足 **topic 含 `dsh-plugin`**，并且具备下列之一，即视为 DSH 插件：
   - `dsh.bundle`（`patch` 为不含 `..`、非绝对路径的相对路径 → Manifest `shape_validated`）
   - `dsh.plugin`
   - 名称/简介明显与 DSH 相关
4. 写入站点存储 `data/plugins.json`：
   - `source: "discovered"`
   - 已有 `source: "curated"` 的条目会保留，只更新 stars / forks / pushedAt / icon
   - 新发现的插件追加
   - 已消失且确认归档/404 的 discovered 条目会删除；**不会**清掉 curated
   - **不会**改动 `data/submissions.json`
   - 若新快照 published 数量比上一版下降超过 40%，中止写入
5. 仅当 `plugins.json` 有变化时，推到分支 `discover/sync` 并开（或更新）一条 PR：`Review: discovered dsh plugins`。**不再直接推 `main`。**
6. 社区目录 Manifest 复核：手动跑 `.github/workflows/review-curated.yml`（`node scripts/discover.mjs --review-curated`），有改动则开/更新 `review/curated-manifest` PR。

本地也可跑同一脚本：

```bash
# 建议设置 PAT，否则未认证搜索很容易 60 次/小时限流
export GITHUB_TOKEN=ghp_...
node scripts/discover.mjs

# 只处理一个仓库
node scripts/discover.mjs --repo owner/repo

# 复核社区目录里尚未检查的 Manifest（不删行）
node scripts/discover.mjs --review-curated
```

Actions 里 `GITHUB_TOKEN` 会自动注入，公开搜索不需要额外 secret。未认证限额很低；仓库级 token 的 Search 限额大约 30 次/分钟。若要扫得更全，可在仓库 Settings → Secrets 放入个人 PAT，并在 workflow 里改用该 secret（仍可命名为覆盖 `GITHUB_TOKEN` 的自定义 secret）。

## 用户如何发布

正式通道是本仓库的 GitHub Issue，没有单独账号。

1. 打开 [publish.html](publish.html)，输入 `owner/repo` 或 GitHub URL，先跑浏览器预检。
2. 点「提交」会打开预填 Issue（模板：`.github/ISSUE_TEMPLATE/plugin_submission.yml`，字段：仓库 URL、owner/repo、备注）。
3. `.github/workflows/ingest-submission.yml` 在 Issue 打开或打上 `submission` 标签后运行：
   - 从正文解析 GitHub 仓库
   - 单仓发现：Manifest 通过 → 写入 `data/plugins.json`（`source: "curated"`）；否则写入 `data/submissions.json` 待审
   - 在 Issue 下评论结果
   - 提交到分支 `submission/<issue-number>` 并 `gh pr create`
4. **维护者合并 PR 后**，站点数据才更新。

流程一句话：**用户提交 Issue → Action 预检 → 开 PR → 维护者合并 → 站点数据更新。**

## 本地预览

```bash
python3 -m http.server 8787
```

打开 `http://127.0.0.1:8787/`。前端一次加载 `/data/plugins.json`。语言：顶栏 `中文` / `EN`，写入 `localStorage` 键 `dsh-registry.locale`（默认 `zh`），也可用 `?lang=en` / `?lang=zh`。

## 页面

| 文件 | 路由 |
| --- | --- |
| `index.html` | 浏览、搜索、筛选 |
| `plugin-detail.html?plugin=<id>` | 详情 + 安装弹层 |
| `publish.html` | 仓库预检 → GitHub Issue |
| `dashboard.html` | KPI 与榜单 |
| `policy.html` | 收录规范（中英全文） |

浏览页查询串：`?q=&category=&source=&manifest=&language=&sort=&lang=`。

配置：`data/config.json` → `{ "repo": "vbarter/dsh-plugin-registry", "topic": "dsh-plugin", "discoverEvery": "2h" }`。

## Cloudflare 部署

静态输出目录是仓库根目录。把 Cloudflare Pages 接到本仓库、生产分支 `main` 即可；GitHub Actions **不需要** Cloudflare secret。`.github/workflows/pages.yml` 只是提醒，不会调用 wrangler。

```bash
# 可选：本机用 wrangler 推一次（未要求不要跑）
npx --yes wrangler@3 pages deploy . --project-name=dsh-plugin-registry --branch=main
```

---

## English

Static community registry for DeepSeek Harness plugins. The committed file `data/plugins.json` is the site store; GitHub Actions are the backend.

**All catalog writes go through GitHub PRs** — never a direct push to `main`. Maintainers merge at [Pull Requests](https://github.com/vbarter/dsh-plugin-registry/pulls):

- user submissions → `submission/<n>`
- discovery sync → `discover/sync`
- curated Manifest review → `review/curated-manifest`

**Discovery.** `scripts/discover.mjs` searches `topic:dsh-plugin`, reads each root `package.json`, and merges plugins into the snapshot. Curated rows are kept. Discovered rows that are gone *and* archived/missing are dropped. A >40% drop in `published` aborts the write. Cron: every 2 hours; if `plugins.json` changed, the workflow opens/updates one PR on `discover/sync` instead of pushing `main`. `GITHUB_TOKEN` is enough for public search in Actions; unauthenticated runs hit rate limits quickly.

**Curated Manifest review.** `node scripts/discover.mjs --review-curated` (manual `workflow_dispatch`) rechecks curated rows whose Manifest is missing or `not_checked`. Rows are never dropped; 404 / unclassified repos are marked `not_validated`. Changes go to `review/curated-manifest`.

**Publish.** Users open a prefilled Issue on `vbarter/dsh-plugin-registry`. The ingest workflow prechecks the repo, writes `plugins.json` (curated) or `submissions.json` (pending), comments on the Issue, and opens PR `submission/<n>`. Maintainers merge to update the site.

**Local.** `node scripts/discover.mjs` or `--review-curated` (set `GITHUB_TOKEN` if you can). Serve with any static server. Locale: `中文` / `EN`, persisted as `dsh-registry.locale`, override with `?lang=`.
