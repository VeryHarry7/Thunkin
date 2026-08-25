#!/usr/bin/env bash
#
# A throwaway Postgres for local development and integration tests.
#
# Uses the Postgres binaries already on the machine rather than Docker, so it
# works in containers where no daemon is running. The cluster lives under
# .pgdata/ (gitignored) and holds nothing worth keeping — `reset` is always safe.
#
#   ./scripts/dev-db.sh start | stop | reset | status | url
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="$ROOT/.pgdata"
PGPORT="${PGPORT:-5433}"
PGDB="${PGDB:-thunkin}"
LOG="$PGDATA/server.log"

# Prefer a versioned bin directory; fall back to whatever is on PATH.
if [ -d /usr/lib/postgresql ]; then
  PGBIN="/usr/lib/postgresql/$(ls -1 /usr/lib/postgresql | sort -Vr | head -1)/bin"
else
  PGBIN="$(dirname "$(command -v postgres)")"
fi

DB_URL="postgres://postgres@127.0.0.1:$PGPORT/$PGDB"

# initdb and postgres refuse to run as root, so use a non-root account when we
# happen to be root (common in CI images and dev containers).
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  if ! id postgres >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/postgresql --shell /bin/bash postgres
  fi
  RUNAS="postgres"
fi

run() {
  if [ -n "$RUNAS" ]; then
    su "$RUNAS" -c "$*"
  else
    bash -c "$*"
  fi
}

is_running() {
  run "$PGBIN/pg_ctl -D '$PGDATA' status" >/dev/null 2>&1
}

start() {
  if is_running; then
    echo "already running on port $PGPORT"
    echo "$DB_URL"
    return 0
  fi

  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "initialising cluster in $PGDATA"
    mkdir -p "$PGDATA"
    [ -n "$RUNAS" ] && chown -R "$RUNAS" "$PGDATA"
    run "$PGBIN/initdb -D '$PGDATA' -U postgres --auth=trust --encoding=UTF8" >/dev/null
  fi

  echo "starting postgres on port $PGPORT"
  run "$PGBIN/pg_ctl -D '$PGDATA' -o '-p $PGPORT -k $PGDATA' -l '$LOG' -w start" >/dev/null

  if ! run "$PGBIN/psql -h 127.0.0.1 -p $PGPORT -U postgres -lqt" 2>/dev/null | cut -d'|' -f1 | grep -qw "$PGDB"; then
    run "$PGBIN/createdb -h 127.0.0.1 -p $PGPORT -U postgres '$PGDB'"
    echo "created database $PGDB"
  fi

  echo "$DB_URL"
}

case "${1:-start}" in
  start)  start ;;
  stop)   is_running && run "$PGBIN/pg_ctl -D '$PGDATA' -m fast -w stop" >/dev/null && echo "stopped" || echo "not running" ;;
  reset)  "$0" stop >/dev/null 2>&1 || true; rm -rf "$PGDATA"; echo "removed $PGDATA"; start ;;
  status) is_running && echo "running on port $PGPORT" || { echo "not running"; exit 1; } ;;
  url)    echo "$DB_URL" ;;
  *)      echo "usage: $0 {start|stop|reset|status|url}" >&2; exit 2 ;;
esac
