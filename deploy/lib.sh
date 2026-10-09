# Shared by setup.sh and deploy.sh: load the configuration and fill defaults.
# shellcheck shell=bash

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

# parse_common <args…>: take --config <file> out of the arguments (sets
# OLT_CONFIG); the rest is left in REST for the script's own options.
parse_common() {
  REST=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --config) [ $# -ge 2 ] || die "--config needs a file"; OLT_CONFIG=$2; shift 2 ;;
      --config=*) OLT_CONFIG=${1#--config=}; shift ;;
      *) REST+=("$1"); shift ;;
    esac
  done
}

load_config() {
  OLT_CONFIG=${OLT_CONFIG:-/etc/open-layout-tool/olt.env}
  [ -f "$OLT_CONFIG" ] || die "no configuration at $OLT_CONFIG (copy deploy/olt.env.example there)"
  OLT_CONFIG=$(cd "$(dirname "$OLT_CONFIG")" && pwd)/$(basename "$OLT_CONFIG")
  set -a
  # shellcheck disable=SC1090
  . "$OLT_CONFIG"
  set +a

  local here sfx
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  : "${OLT_DOMAIN:?OLT_DOMAIN must be set in $OLT_CONFIG}"
  # Several instances on one machine (test and production): an instance name
  # puts its own prefix on the units, user and data directory. Empty is the
  # first instance with the plain names (olt-server, olt, /var/lib/open-layout-tool).
  OLT_INSTANCE=${OLT_INSTANCE:-}
  case "$OLT_INSTANCE" in *[!a-z0-9]*) die "OLT_INSTANCE may only hold a-z and 0-9" ;; esac
  sfx=${OLT_INSTANCE:+-$OLT_INSTANCE}
  OLT_UNIT_PREFIX=olt$sfx-
  OLT_LABEL=${OLT_INSTANCE:+ [$OLT_INSTANCE]}
  OLT_REPO=${OLT_REPO:-$here}
  OLT_USER=${OLT_USER:-olt$sfx}
  OLT_DATA=${OLT_DATA:-/var/lib/open-layout-tool$sfx}
  OLT_DB=${OLT_DB:-$OLT_DATA/olt.sqlite}
  OLT_BACKUPS=${OLT_BACKUPS:-$OLT_DATA/backups}
  OLT_BACKUP_DAYS=${OLT_BACKUP_DAYS:-30}
  OLT_VENV=${OLT_VENV:-$OLT_DATA/venv}
  OLT_TERRAIN_CACHE=${OLT_TERRAIN_CACHE:-$OLT_DATA/terrain-cache}
  OLT_CLOUDS=${OLT_CLOUDS:-$OLT_DATA/clouds}
  OLT_BIND=${OLT_BIND:-127.0.0.1}
  OLT_SERVER_PORT=${OLT_SERVER_PORT:-8787}
  OLT_OPTIMIZER_PORT=${OLT_OPTIMIZER_PORT:-8099}
  OLT_SERVER_LOG=${OLT_SERVER_LOG:-info}
  OLT_CADDY=${OLT_CADDY:-system}
  OLT_UPSTREAM=${OLT_UPSTREAM:-$OLT_BIND}
  OLT_SITE_ROOT=${OLT_SITE_ROOT:-$OLT_REPO/dist}
  OLT_TRUST_PROXY=${OLT_TRUST_PROXY:-127.0.0.1,::1}
  if [ "$OLT_CADDY" = system ]; then OLT_CADDY_DIR=${OLT_CADDY_DIR:-/etc/caddy/conf.d}
  else OLT_CADDY_DIR=${OLT_CADDY_DIR:-$OLT_DATA}; fi
  OLT_CADDY_SITE=$OLT_CADDY_DIR/open-layout-tool$sfx.caddy
  OLT_CADDY_RELOAD=${OLT_CADDY_RELOAD:-}
  OLT_ADMIN_LOGIN=${OLT_ADMIN_LOGIN:-admin}
  OLT_OPTIMIZER_TIMEOUT=${OLT_OPTIMIZER_TIMEOUT:-120}
  OLT_OPTIMIZER_WORKERS=${OLT_OPTIMIZER_WORKERS:-2}
  OLT_CLOUDJOBS_PARALLEL=${OLT_CLOUDJOBS_PARALLEL:-2}
  OLT_CLOUDRUNS_PARALLEL=${OLT_CLOUDRUNS_PARALLEL:-2}
  # Memory per service (systemd MemoryMax). The point cloud jobs: up to
  # OLT_CLOUDJOBS_PARALLEL preparations of 768 MB heap and OLT_CLOUDRUNS_PARALLEL
  # long runs of 320 MB, plus the queue process — 3G holds two of each.
  OLT_CLOUDJOBS_MEMORY=${OLT_CLOUDJOBS_MEMORY:-3G}
  OLT_SERVER_MEMORY=${OLT_SERVER_MEMORY:-infinity}
  OLT_OPTIMIZER_MEMORY=${OLT_OPTIMIZER_MEMORY:-infinity}
  # What deploy.sh may put on this instance: "main" (git pull, the test
  # server) or "tags" (only prod-* tags with a green CI, production).
  OLT_TRACK=${OLT_TRACK:-main}
  OLT_GITHUB_REPO=${OLT_GITHUB_REPO:-Serigalan/open-layout-tool}
  OLT_NODE=${OLT_NODE:-$(command -v node || echo /usr/bin/node)}
  OLT_STATE=$OLT_DATA/.deploy-state
  export OLT_DOMAIN OLT_INSTANCE OLT_UNIT_PREFIX OLT_LABEL OLT_REPO OLT_USER OLT_DATA OLT_DB \
    OLT_BACKUPS OLT_BACKUP_DAYS OLT_VENV OLT_TERRAIN_CACHE OLT_CLOUDS OLT_BIND OLT_SERVER_PORT \
    OLT_OPTIMIZER_PORT OLT_SERVER_LOG OLT_CADDY OLT_UPSTREAM OLT_SITE_ROOT OLT_TRUST_PROXY \
    OLT_CADDY_DIR OLT_CADDY_SITE OLT_CADDY_RELOAD OLT_ADMIN_LOGIN OLT_OPTIMIZER_TIMEOUT \
    OLT_OPTIMIZER_WORKERS OLT_CLOUDJOBS_PARALLEL OLT_CLOUDRUNS_PARALLEL OLT_CLOUDJOBS_MEMORY \
    OLT_SERVER_MEMORY OLT_OPTIMIZER_MEMORY OLT_TRACK OLT_GITHUB_REPO OLT_NODE

  case "$OLT_BIND" in 0.0.0.0|::|'') die "OLT_BIND=$OLT_BIND would put the services on every interface" ;; esac
  case "$OLT_CADDY" in system|external) ;; *) die "OLT_CADDY must be system or external" ;; esac
  case "$OLT_TRACK" in main|tags) ;; *) die "OLT_TRACK must be main or tags" ;; esac
}

# The units of this instance, as installed (template olt-<x> → $OLT_UNIT_PREFIX<x>).
# shellcheck disable=SC2034  # used by setup.sh
UNIT_TEMPLATES=(olt-server.service olt-optimizer.service olt-cloudjobs.service olt-server-backup.service olt-server-backup.timer)
unit_name() { echo "$OLT_UNIT_PREFIX${1#olt-}"; }
SERVICES=(server optimizer cloudjobs)
service_units() { local s; for s in "${SERVICES[@]}"; do echo "${OLT_UNIT_PREFIX}$s.service"; done; }

# ci_green <commit>: true when GitHub's CI finished green for that commit.
ci_green() {
  curl -fsS "https://api.github.com/repos/$OLT_GITHUB_REPO/actions/runs?head_sha=$1&per_page=20" 2>/dev/null \
    | python3 -c 'import json, sys
runs = json.load(sys.stdin).get("workflow_runs", [])
sys.exit(0 if any(r.get("conclusion") == "success" for r in runs) else 1)'
}

# render <template> <target>: replace every @OLT_…@ in the template by the
# variable's value. Fails on a placeholder that has no value.
render() {
  python3 - "$1" "$2" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
def sub(m):
    name = m.group(1)
    if name not in os.environ:
        sys.exit(f"{src}: no value for {name}")
    return os.environ[name]
out = re.sub(r"@(OLT_[A-Z_]+)@", sub, text)
tmp = dst + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    f.write(out)
os.replace(tmp, dst)
PY
}

# as_user <cmd…>: run a command as the service user (plain when that is us).
as_user() {
  if [ "$(id -un)" = "$OLT_USER" ]; then "$@"; else runuser -u "$OLT_USER" -- "$@"; fi
}

# changed <name> <file…>: true when the files differ from the last time this
# name was marked done (mark_done) — so deploy.sh reinstalls only what changed.
changed() {
  local name=$1; shift
  local sum
  sum=$(cat "$@" 2>/dev/null | sha256sum | cut -d' ' -f1)
  [ "$(cat "$OLT_STATE/$name" 2>/dev/null)" != "$sum" ]
}
mark_done() {
  local name=$1; shift
  mkdir -p "$OLT_STATE"
  cat "$@" 2>/dev/null | sha256sum | cut -d' ' -f1 > "$OLT_STATE/$name"
}
