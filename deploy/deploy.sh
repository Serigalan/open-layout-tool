#!/usr/bin/env bash
# Open Layout Tool — bring a set-up server to the state of the checkout:
# dependencies where they changed, the app build, the optimizer package, a
# copy of the database, a restart of the services and a health check.
#
#   sudo deploy/deploy.sh                    after git pull (or with --pull)
#   sudo deploy/deploy.sh --pull             git pull --ff-only first (OLT_TRACK=main)
#   sudo deploy/deploy.sh --ref prod-…       check out that tag first (OLT_TRACK=tags);
#                                            refused unless CI was green for it (--force)
#   sudo deploy/deploy.sh --check-only       only the health check
#   … --config <file>                        another instance (see setup.sh)
#   (--no-restart is setup.sh's, before the units exist)
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

parse_common "$@"
pull=0 restart=1 build=1 ref='' force=0
set -- "${REST[@]+"${REST[@]}"}"
while [ $# -gt 0 ]; do
  case "$1" in
    --pull) pull=1 ;;
    --ref) [ $# -ge 2 ] || die "--ref needs a tag"; ref=$2; shift ;;
    --ref=*) ref=${1#--ref=} ;;
    --force) force=1 ;;
    --no-restart) restart=0 ;;
    --check-only) build=0 restart=0 ;;
    *) die "unknown option $1" ;;
  esac
  shift
done

load_config
cd "$OLT_REPO"

health() {
  local name=$1 url=$2
  for _ in $(seq 1 30); do
    if curl -fs -o /dev/null "$url"; then echo "$name: ok"; return 0; fi
    sleep 1
  done
  echo "$name: no answer at $url" >&2
  return 1
}

if [ "$build" = 1 ]; then
  if [ "$OLT_TRACK" = tags ]; then
    # Production: only a prod-* tag, accepted on the test server and green in CI.
    [ "$pull" = 0 ] || die "OLT_TRACK=tags: no --pull here, deploy a tag with --ref"
    if [ -n "$ref" ]; then
      case "$ref" in prod-*) ;; *) die "--ref takes a prod-* tag, not $ref" ;; esac
      step "git fetch, check out $ref"
      git fetch -q --tags --force origin
      git rev-parse -q --verify "refs/tags/$ref" >/dev/null || die "no tag $ref on origin"
      sha=$(git rev-list -n1 "$ref")
      if [ "$force" = 1 ]; then
        echo "CI not checked (--force)"
      elif ci_green "$sha"; then
        echo "CI green for ${sha:0:7}"
      else
        die "no green CI run for $ref (${sha:0:7}) — wait for it, or --force"
      fi
      git -c advice.detachedHead=false checkout -q --detach "$ref"
    else
      # Without --ref only what is checked out, and only when it is a tag
      # (setup.sh's first build).
      ref=$(git describe --tags --exact-match --match 'prod-*' HEAD 2>/dev/null) \
        || die "OLT_TRACK=tags: HEAD is not on a prod-* tag — deploy with --ref <tag>"
    fi
  else
    [ -z "$ref" ] || die "--ref is for OLT_TRACK=tags; this instance follows main (--pull)"
    if [ "$pull" = 1 ]; then
      step "git pull"
      git pull --ff-only
    fi
  fi

  if changed npm package-lock.json || [ ! -d node_modules ]; then
    step "npm ci (app)"
    npm ci --no-audit --no-fund
    mark_done npm package-lock.json
  fi
  if changed npm-server tools/server/package-lock.json || [ ! -d tools/server/node_modules ]; then
    step "npm ci (project server)"
    (cd tools/server && npm ci --omit=dev --no-audit --no-fund)
    mark_done npm-server tools/server/package-lock.json
  fi
  if changed pip tools/optimizer/pyproject.toml tools/optimizer/requirements.lock || [ ! -x "$OLT_VENV/bin/olt-optimizer-serve" ]; then
    step "pip install (optimizer, editable)"
    # Editable: the service reads src/core/constraints through the symlink
    # olt_optimizer/constraints, so app and service always read the same
    # catalogue files (the app compares their hash, R0.1). The versions come
    # from requirements.lock, the same on every server and in CI.
    "$OLT_VENV/bin/pip" install -q --upgrade pip
    "$OLT_VENV/bin/pip" install -q -c tools/optimizer/requirements.lock -e 'tools/optimizer[terrain]'
    mark_done pip tools/optimizer/pyproject.toml tools/optimizer/requirements.lock
  fi

  step "Build"
  # Built beside dist/ and then synced into it: the directory itself stays
  # (a Caddy in a container may have it bind-mounted), and the site is never
  # half empty while vite writes.
  out=$(mktemp -d "$OLT_REPO/.tmp-build-XXXX")
  trap 'rm -rf "$out"' EXIT
  npx vite build --outDir "$out" --emptyOutDir
  mkdir -p dist
  rsync -a --delete "$out/" dist/
  chmod -R a+rX dist
  mkdir -p "$OLT_STATE"
  git rev-parse HEAD > "$OLT_STATE/commit"
  echo "${ref:-$(git rev-parse --abbrev-ref HEAD)}" > "$OLT_STATE/ref"
fi

mapfile -t services < <(service_units)
if [ "$restart" = 1 ]; then
  # Migrations only go forward: a copy from just before the new code starts
  # is what a step back to the previous state needs. Same name pattern as the
  # daily copy, so the backup timer prunes it after OLT_BACKUP_DAYS.
  if [ -f "$OLT_DB" ]; then
    step "Database copy"
    copy="$OLT_BACKUPS/olt-$(date +%F)-predeploy-$(date +%H%M%S).sqlite"
    (cd tools/server && OLT_SERVER_DB="$OLT_DB" as_user "$OLT_NODE" bin/olt-server.mjs backup "$copy")
  fi
  step "Restart"
  for u in "${services[@]}"; do
    if [ -f "/etc/systemd/system/$u" ]; then
      systemctl restart "$u"
    else
      echo "$u is not installed — run deploy/setup.sh once"
    fi
  done
fi

if [ "$build" = 0 ] || [ "$restart" = 1 ]; then
  step "Health"
  health "project server" "http://$OLT_BIND:$OLT_SERVER_PORT/api/health"
  health "optimizer" "http://$OLT_BIND:$OLT_OPTIMIZER_PORT/health"
fi
