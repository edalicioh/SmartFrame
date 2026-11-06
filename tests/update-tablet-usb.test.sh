#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/smartframe-tablet-test.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/bin"
printf 'APK de teste\n' > "$tmp/app.apk"
touch "$tmp/log"
cat > "$tmp/bin/adb" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$ADB_LOG"
[[ $1 == -s && $2 == TABLET-123 ]] || exit 1
shift 2
case "$*" in
  get-state) echo "${TABLET_STATE:-device}"; [[ ${TABLET_STATE:-device} != missing ]] ;;
  get-devpath) echo "${TABLET_TRANSPORT:-usb:1-1}" ;;
  'shell pm path com.smartframe.player') [[ ${MISSING_APP:-0} != 1 ]] && echo 'package:/data/app/~~signature/com.smartframe.player-test/base.apk' ;;
  'install -r '*)
    if [[ ${INSTALL_FAIL:-0} == 1 ]]; then echo 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]'; exit 1; fi
    if [[ ${INSTALL_FAIL:-0} == 2 ]]; then echo 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]'; exit 0; fi
    [[ ${INSTALL_FAIL:-0} != 3 ]] || exit 124
    echo 'Performing Streamed Install'; echo Success ;;
  'pull '*)
    if [[ ${BAD_HASH:-0} == 1 ]]; then printf 'Outro APK' > "$3"; else cp "$FAKE_APK" "$3"; fi ;;
  'shell am start -W -n com.smartframe.player/.MainActivity')
    if [[ ${START_FAIL:-0} == 1 ]]; then echo 'Error type 3'; else echo 'Status: ok'; fi ;;
  'shell pidof com.smartframe.player') [[ ${DEAD_APP:-0} != 1 ]] && echo 1234 ;;
  *) echo "Comando inesperado: $*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$tmp/bin/adb"
export PATH="$tmp/bin:$PATH" ADB_LOG="$tmp/log" FAKE_APK="$tmp/app.apk"
export SMARTFRAME_TABLET_SERIAL=TABLET-123 GITHUB_STEP_SUMMARY="$tmp/summary"
unset ADB_PATH

run_update() { bash "$root/scripts/update-tablet-usb.sh" "$tmp/app.apk" > "$tmp/out" 2>&1; }
clear_log() { : > "$ADB_LOG"; : > "$GITHUB_STEP_SUMMARY"; }
assert_called() { grep -Fq -- "$1" "$ADB_LOG"; }
assert_not_called() { if grep -Fq -- "$1" "$ADB_LOG"; then echo "Comando inesperado: $1" >&2; exit 1; fi; }
expect_failure() { if run_update; then echo 'Uma falha foi ignorada.' >&2; exit 1; fi; }

clear_log
unset SMARTFRAME_TABLET_SERIAL
run_update
[[ ! -s "$ADB_LOG" ]]
grep -Fq 'pendente' "$GITHUB_STEP_SUMMARY"

export SMARTFRAME_TABLET_SERIAL=192.168.1.50:5555
expect_failure
[[ ! -s "$ADB_LOG" ]]
export SMARTFRAME_TABLET_SERIAL=TABLET-123

if bash "$root/scripts/update-tablet-usb.sh" "$tmp/missing.apk" > "$tmp/out" 2>&1; then
  echo 'APK ausente foi aceito.' >&2; exit 1
fi
[[ ! -s "$ADB_LOG" ]]
export ADB_PATH="$tmp/missing-adb"
expect_failure
[[ ! -s "$ADB_LOG" ]]
unset ADB_PATH

for state in missing offline unauthorized; do
  clear_log
  export TABLET_STATE=$state
  run_update
  assert_not_called 'install '
  grep -Fq 'pendente' "$GITHUB_STEP_SUMMARY"
done
unset TABLET_STATE

clear_log
export TABLET_TRANSPORT=tcp:192.168.1.50
expect_failure
assert_not_called 'install '
unset TABLET_TRANSPORT

clear_log
export MISSING_APP=1
expect_failure
assert_not_called 'install '
unset MISSING_APP

for failure in 1 2 3; do
  clear_log
  export INSTALL_FAIL=$failure
  expect_failure
  assert_called 'install -r '
  assert_not_called 'shell am start'
done
unset INSTALL_FAIL

clear_log
export BAD_HASH=1
expect_failure
assert_not_called 'shell am start'
unset BAD_HASH

clear_log
export START_FAIL=1
expect_failure
unset START_FAIL

clear_log
export DEAD_APP=1
expect_failure
unset DEAD_APP

clear_log
run_update
assert_called 'install -r '
assert_called 'shell am start -W -n com.smartframe.player/.MainActivity'
assert_called 'shell pidof com.smartframe.player'
assert_not_called 'uninstall'
assert_not_called 'install -r -d'
assert_not_called 'pm clear'
assert_not_called 'kill-server'
grep -Fq 'instalado e SmartFrame reaberto' "$GITHUB_STEP_SUMMARY"
echo 'Testes de atualização USB passaram.'
