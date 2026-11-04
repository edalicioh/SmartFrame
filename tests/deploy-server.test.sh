#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/smartframe-deploy-test.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/backups"
touch "$tmp/env" "$tmp/log"
cat >"$tmp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  "volume inspect "*) [[ ${MISSING_VOLUME:-0} != 1 ]] ;;
  "run "*) [[ ${FAIL_BACKUP:-0} != 1 ]] ;;
  *" run --rm --no-deps migrate") [[ ${FAIL_MIGRATION:-0} != 1 ]] ;;
  *" ps -q web") echo web-container ;;
  *" ps -q worker") echo worker-container ;;
  "inspect "*"worker-container") echo "${WORKER_STATE:-running}" ;;
  "inspect "*) echo "${WEB_HEALTH:-healthy}" ;;
esac
MOCK
chmod +x "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH"
export SMARTFRAME_ENV_FILE="$tmp/env" SMARTFRAME_BACKUP_DIR="$tmp/backups"
export DOCKER_LOG="$tmp/log" GITHUB_SHA=0123456789abcdef0123456789abcdef01234567
unset BETTER_AUTH_SECRET BETTER_AUTH_URL SMARTFRAME_ADMIN_LOGIN SMARTFRAME_ADMIN_EMAIL
unset SMARTFRAME_ONLINE_HOUSEHOLD_ID SMARTFRAME_BIND SMARTFRAME_PORT

clear_log() { : >"$DOCKER_LOG"; }
assert_called() { grep -Fq -- "$1" "$DOCKER_LOG"; }
assert_not_called() { if grep -Fq -- "$1" "$DOCKER_LOG"; then echo "Comando inesperado: $1" >&2; exit 1; fi; }

export MISSING_VOLUME=1
if bash "$root/scripts/deploy-server.sh" >"$tmp/out" 2>&1; then echo 'Volume ausente foi aceito.' >&2; exit 1; fi
assert_not_called 'build web'
assert_not_called 'stop nginx web worker'
unset MISSING_VOLUME

clear_log
export FAIL_BACKUP=1
if bash "$root/scripts/deploy-server.sh" >"$tmp/out" 2>&1; then echo 'Falha de backup foi ignorada.' >&2; exit 1; fi
assert_called 'stop nginx web worker'
assert_not_called 'run --rm --no-deps migrate'
unset FAIL_BACKUP

clear_log
export FAIL_MIGRATION=1
if bash "$root/scripts/deploy-server.sh" >"$tmp/out" 2>&1; then echo 'Falha de migration foi ignorada.' >&2; exit 1; fi
assert_called 'run --rm --no-deps migrate'
assert_not_called 'up -d --no-deps web worker'
unset FAIL_MIGRATION

clear_log
export WEB_HEALTH=unhealthy
if bash "$root/scripts/deploy-server.sh" >"$tmp/out" 2>&1; then echo 'Falha de healthcheck foi ignorada.' >&2; exit 1; fi
assert_called 'up -d --no-deps web worker'
assert_not_called 'up -d --no-deps --force-recreate nginx'
unset WEB_HEALTH

clear_log
export WORKER_STATE=exited
if bash "$root/scripts/deploy-server.sh" >"$tmp/out" 2>&1; then echo 'Falha do worker foi ignorada.' >&2; exit 1; fi
assert_not_called 'up -d --no-deps --force-recreate nginx'
unset WORKER_STATE

clear_log
bash "$root/scripts/deploy-server.sh" >"$tmp/out" 2>&1
assert_called 'build web'
assert_called 'stop nginx web worker'
assert_called 'run --rm --no-deps migrate'
assert_called 'up -d --no-deps web worker'
assert_called 'up -d --no-deps --force-recreate nginx'
assert_not_called 'down -v'

clear_log
export BETTER_AUTH_URL=http://unexpected.example
if bash "$root/scripts/deploy-server.sh" >"$tmp/out" 2>&1; then echo 'Variável herdada foi aceita.' >&2; exit 1; fi
assert_not_called 'build web'
echo 'Testes de deploy passaram.'
