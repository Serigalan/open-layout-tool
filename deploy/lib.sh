# Shared by setup.sh and deploy.sh: load the configuration and fill defaults.
# shellcheck shell=bash

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

load_config() {
  OLT_CONFIG=${OLT_CONFIG:-/etc/open-layout-tool/olt.env}
  [ -f "$OLT_CONFIG" ] || die "no configuration at $OLT_CONFIG (copy deploy/olt.env.example there)"
  set -a
  # shellcheck disable=SC1090
  . "$OLT_CONFIG"
  set +a

  local here
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  : "${OLT_DOMAIN:?OLT_DOMAIN must be set in $OLT_CONFIG}"
  OLT_REPO=${OLT_REPO:-$here}
  OLT_USER=${OLT_USER:-olt}
  OLT_DATA=${OLT_DATA:-/var/lib/open-layout-tool}
  OLT_DB=${OLT_DB:-$OLT_DATA/olt.sqlite}
  OLT_BACKUPS=${OLT_BACKUPS:-$OLT_DATA/backups}
  OLT_BACKUP_DAYS=${OLT_BACKUP_DAYS:-30}
  OLT_VENV=${OLT_VENV:-$OLT_DATA/venv}
  OLT_TERRAIN_CACHE=${OLT_TERRAIN_CACHE:-$OLT_DATA/terrain-cache}
  OLT_BIND=${OLT_BIND:-127.0.0.1}
  OLT_SERVER_PORT=${OLT_SERVER_PORT:-8787}
  OLT_OPTIMIZER_PORT=${OLT_OPTIMIZER_PORT:-8099}
  OLT_CADDY=${OLT_CADDY:-system}
  OLT_UPSTREAM=${OLT_UPSTREAM:-$OLT_BIND}
  OLT_SITE_ROOT=${OLT_SITE_ROOT:-$OLT_REPO/dist}
  OLT_TRUST_PROXY=${OLT_TRUST_PROXY:-127.0.0.1,::1}
  OLT_ADMIN_LOGIN=${OLT_ADMIN_LOGIN:-admin}
  OLT_OPTIMIZER_TIMEOUT=${OLT_OPTIMIZER_TIMEOUT:-120}
  OLT_OPTIMIZER_WORKERS=${OLT_OPTIMIZER_WORKERS:-2}
  OLT_NODE=${OLT_NODE:-$(command -v node || echo /usr/bin/node)}
  OLT_STATE=$OLT_DATA/.deploy-state
  export OLT_DOMAIN OLT_REPO OLT_USER OLT_DATA OLT_DB OLT_BACKUPS OLT_BACKUP_DAYS OLT_VENV \
    OLT_TERRAIN_CACHE OLT_BIND OLT_SERVER_PORT OLT_OPTIMIZER_PORT OLT_CADDY OLT_UPSTREAM \
    OLT_SITE_ROOT OLT_TRUST_PROXY OLT_ADMIN_LOGIN OLT_OPTIMIZER_TIMEOUT OLT_OPTIMIZER_WORKERS OLT_NODE

  case "$OLT_BIND" in 0.0.0.0|::|'') die "OLT_BIND=$OLT_BIND would put the services on every interface" ;; esac
  case "$OLT_CADDY" in system|external) ;; *) die "OLT_CADDY must be system or external" ;; esac
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
