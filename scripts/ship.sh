#!/usr/bin/env bash
# Usage: ship "feat: what you changed"
set -euo pipefail

msg="${1:-}"
[ -n "$msg" ] || { echo 'usage: ship "feat: what you changed"'; exit 1; }
[ -n "$(git status --porcelain)" ] || { echo "Nothing to ship."; exit 1; }

branch=$(git branch --show-current)
if [ "$branch" = "main" ]; then
  git pull --ff-only
  branch=$(echo "$msg" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-40)
  git switch -c "$branch"
fi

echo; git status --short; echo
read -r -p "Ship these changes as \"$msg\"? [y/N] " ok
[ "$ok" = "y" ] || { echo "Cancelled. You are on $branch with your changes intact."; exit 1; }

git add -A
git commit -m "$msg"
git push -u origin HEAD
pr=$(gh pr create --fill | tail -1)
echo "$pr"
gh pr merge "$pr" --auto --squash --delete-branch

sleep 8
gh pr checks "$pr" --watch || {
  echo "CI failed. Read the error: gh run view --log-failed | head -30"
  echo "Then fix it on this branch and run: git add -A && git commit -m \"fix: ...\" && git push"
  exit 1
}

# wait until GitHub reports the PR as merged
for _ in $(seq 30); do
  [ "$(gh pr view "$pr" --json state --jq .state)" = "MERGED" ] && break
  sleep 2
done

git switch main
git pull --ff-only
git branch -D "$branch"
echo "Merged. Watching the deploy:"
sleep 5
gh run watch "$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
