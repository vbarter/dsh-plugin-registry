#!/usr/bin/env bash
# After a GITHUB_TOKEN merge, push workflows do not run. Poll until the PR
# is actually merged (gh pr merge --auto often only arms auto-merge), then
# dispatch pages.yml once if github-actions merged it.
# A human merge already fires pages.yml on push; do not dispatch those.
set -euo pipefail

PR="${1:?usage: dispatch-pages-after-merge.sh <pr-number>}"
REPO="${REPO:-${GITHUB_REPOSITORY:-}}"
ATTEMPTS="${DISPATCH_POLL_ATTEMPTS:-36}"
SLEEP="${DISPATCH_POLL_SLEEP:-5}"

if [ -z "$REPO" ]; then
  echo "REPO or GITHUB_REPOSITORY is required" >&2
  exit 1
fi
case "$REPO" in
  [A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*) ;;
  *)
    echo "unexpected repository: $REPO" >&2
    exit 1
    ;;
esac

is_actions_bot() {
  [ "$1" = "app/github-actions" ] || [ "$1" = "github-actions[bot]" ]
}

on_main() {
  local sha="$1" status
  case "$sha" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
    *) return 1 ;;
  esac
  if ! status=$(gh api "repos/${REPO}/compare/main...${sha}" --jq .status); then
    return 1
  fi
  case "$status" in
    identical | behind) return 0 ;;
    *) return 1 ;;
  esac
}

dispatch_pages() {
  local n
  for n in 1 2 3; do
    if gh workflow run pages.yml --repo "$REPO" --ref main; then
      echo "Dispatched pages.yml on main"
      return 0
    fi
    echo "workflow dispatch failed (attempt ${n}); retrying" >&2
    sleep "$SLEEP"
  done
  return 1
}

i=1
while [ "$i" -le "$ATTEMPTS" ]; do
  if ! info=$(gh pr view "$PR" --repo "$REPO" --json state,mergedBy,mergeCommit \
    --jq '[.state, (.mergedBy.login // ""), (.mergeCommit.oid // "")] | @tsv'); then
    echo "pr view failed; retrying" >&2
    sleep "$SLEEP"
    i=$((i + 1))
    continue
  fi
  state=$(printf '%s' "$info" | cut -f1)
  by=$(printf '%s' "$info" | cut -f2)
  sha=$(printf '%s' "$info" | cut -f3)

  if [ "$state" = "MERGED" ]; then
    if [ -z "$by" ]; then
      echo "PR #${PR} merged; waiting for mergedBy"
    elif ! is_actions_bot "$by"; then
      echo "PR #${PR} merged by ${by}; push will run pages.yml"
      exit 0
    elif [ -n "$sha" ] && on_main "$sha"; then
      echo "PR #${PR} merged by ${by} (${sha}); dispatching pages.yml"
      dispatch_pages
      exit 0
    else
      echo "PR #${PR} merged by ${by}; waiting for ${sha:-merge commit} on main"
    fi
  elif [ "$state" = "CLOSED" ]; then
    echo "PR #${PR} closed without merge; not dispatching"
    exit 0
  else
    echo "PR #${PR} is ${state:-unknown}; waiting for merge"
  fi

  sleep "$SLEEP"
  i=$((i + 1))
done

if [ "${state:-}" = "MERGED" ] && { [ -z "${by:-}" ] || is_actions_bot "${by:-}"; }; then
  echo "PR #${PR} merged by ${by:-unknown} but the merge commit was not confirmed on main" >&2
  exit 1
fi
echo "PR #${PR} not merged; not dispatching"
exit 0
