#!/usr/bin/env bash
# Open Layout Tool — mark a commit as a release for production: the next free
# tag prod-YYYY-MM-DD (then .2, .3 …), only when GitHub's CI is green for it,
# pushed to origin. Run in any checkout; the production instance then takes it
# with deploy/deploy.sh --ref <tag>.
#
#   deploy/release.sh             origin/main
#   deploy/release.sh <commit>    that commit
set -euo pipefail
die() { echo "error: $*" >&2; exit 1; }
cd "$(dirname "$0")/.."

OLT_GITHUB_REPO=${OLT_GITHUB_REPO:-Serigalan/open-layout-tool}
git fetch -q --tags origin
sha=$(git rev-parse --verify "${1:-origin/main}^{commit}") || die "no commit ${1:-origin/main}"

existing=$(git tag --points-at "$sha" --list 'prod-*' | head -1)
[ -z "$existing" ] || { echo "$existing already marks ${sha:0:7}"; exit 0; }

curl -fsS "https://api.github.com/repos/$OLT_GITHUB_REPO/actions/runs?head_sha=$sha&per_page=20" \
  | python3 -c 'import json, sys
runs = json.load(sys.stdin).get("workflow_runs", [])
sys.exit(0 if any(r.get("conclusion") == "success" for r in runs) else 1)' \
  || die "no green CI run for ${sha:0:7} yet"

tag=prod-$(date +%F)
n=1
while git rev-parse -q --verify "refs/tags/$tag" >/dev/null; do
  n=$((n + 1)); tag=prod-$(date +%F).$n
done
git tag -a "$tag" -m "Release $tag" "$sha"
git push -q origin "$tag"
echo "$tag → ${sha:0:7}: $(git log -1 --format=%s "$sha")"
echo "on the production server: deploy/deploy.sh --config <its olt.env> --ref $tag"
