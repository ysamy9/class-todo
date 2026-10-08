#!/usr/bin/env bash
# Usage: ship "feat: what you changed"
set -euo pipefail

main() {
  msg="${1:-}"
  [ -n "$msg" ] || { echo 'usage: ship "feat: what you changed"'; exit 1; }
  [ -n "$(git status --porcelain)" ] || { echo "Nothing to ship."; exit 1; }

  git fetch -q
  branch=$(git branch --show-current)
  if [ "$branch" = "main" ]; then
    git stash -u -q && git pull --ff-only -q && git stash pop -q
    branch=$(echo "$msg" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-40)
    git switch -c "$branch"
  elif [ "$(git rev-list --count HEAD..origin/main)" -gt 0 ]; then
    echo "main has moved since this branch started."
    echo "Run: git add -A && git commit -m wip && git merge origin/main   (fix any conflict), then ship again."
    exit 1
  fi

  echo; git status --short; echo
  read -r -p "Ship as \"$msg\"? [Y/n] " ok
  [ "${ok:-y}" = "y" ] || { echo "Cancelled. Your changes are intact on $branch."; exit 1; }

  git add -A
  git commit -m "$msg"
  git push -u origin HEAD
  pr=$(gh pr view --json url --jq .url 2>/dev/null || gh pr create --title "$msg" --body "Shipped with scripts/ship.sh" | tail -1)
  echo "$pr"
  gh pr merge "$pr" --auto --squash --delete-branch

  for _ in $(seq 30); do
    [ "$(gh pr view "$pr" --json statusCheckRollup --jq '.statusCheckRollup | length')" -gt 0 ] && break
    if [ "$(gh pr view "$pr" --json mergeable --jq .mergeable)" = "CONFLICTING" ]; then
      echo "Conflict with main. Run: git merge origin/main, fix the files, commit, push."
      exit 1
    fi
    sleep 3
  done

  gh pr checks "$pr" --watch || { echo "CI failed. See: gh run view --log-failed | head -30"; exit 1; }

  for _ in $(seq 30); do
    [ "$(gh pr view "$pr" --json state --jq .state)" = "MERGED" ] && break
    sleep 2
  done
  [ "$(gh pr view "$pr" --json state --jq .state)" = "MERGED" ] || { echo "Not merged yet. Check: gh pr view $pr"; exit 1; }

  git switch main
  git pull --ff-only
  git branch -D "$branch"
  echo "Merged. Watching the deploy:"
  sleep 5
  gh run watch "$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
}

main "$@"
