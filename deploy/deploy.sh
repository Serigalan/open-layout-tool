#!/usr/bin/env bash
# Open Layout Tool — bring a set-up server to the state of the checkout:
# dependencies where they changed, the app build, the optimizer package, a
# restart of both services and a health check.
#
#   sudo deploy/deploy.sh                 after git pull (or with --pull)
#   sudo deploy/deploy.sh --pull          git pull --ff-only first
#   sudo deploy/deploy.sh --check-only    only the health check
#   (--no-restart is setup.sh's, before the units exist)
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

pull=0 restart=1 build=1
for arg in "$@"; do
  case "$arg" in
    --pull) pull=1 ;;
    --no-restart) restart=0 ;;
    --check-only) build=0 restart=0 ;;
    *) die "unknown option $arg" ;;
  esac
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
  if [ "$pull" = 1 ]; then
    step "git pull"
    git pull --ff-only
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
  if changed pip tools/optimizer/pyproject.toml || [ ! -x "$OLT_VENV/bin/olt-optimizer-serve" ]; then
    step "pip install (optimizer, editable)"
    # Editable: the service reads src/constraints through the symlink
    # olt_optimizer/constraints, so app and service always read the same
    # catalogue files (the app compares their hash, R0.1).
    "$OLT_VENV/bin/pip" install -q --upgrade pip
    "$OLT_VENV/bin/pip" install -q -e 'tools/optimizer[terrain]'
    mark_done pip tools/optimizer/pyproject.toml
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
fi

if [ "$restart" = 1 ]; then
  step "Restart"
  systemctl restart olt-server.service olt-optimizer.service
fi

if [ "$build" = 0 ] || [ "$restart" = 1 ]; then
  step "Health"
  health "project server" "http://$OLT_BIND:$OLT_SERVER_PORT/api/health"
  health "optimizer" "http://$OLT_BIND:$OLT_OPTIMIZER_PORT/health"
fi
