#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
apk=${1:-"$root/apps/web/public/downloads/smartframe.apk"}
serial=${SMARTFRAME_TABLET_SERIAL:-}
package=com.smartframe.player
adb=${ADB_PATH:-adb}

summary() {
  echo "$1"
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}
pending() {
  if [[ ${GITHUB_ACTIONS:-} == true ]]; then
    echo "::warning::$1"
  fi
  summary "Atualização USB pendente: $1 O deploy web foi mantido."
  exit 0
}
fail() {
  if [[ ${GITHUB_ACTIONS:-} == true ]]; then
    echo "::error::$1"
  fi
  summary "Falha na atualização USB: $1 O deploy web não foi revertido."
  exit 1
}

# Never infer the destination from the list of attached devices or enable network ADB.
[[ -n "$serial" ]] || pending 'Configure a variável SMARTFRAME_TABLET_SERIAL no GitHub Actions.'
[[ "$serial" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || fail 'Número de série USB inválido.'
[[ -f "$apk" && -r "$apk" && -s "$apk" ]] || fail 'APK ausente, vazio ou inacessível.'
command -v "$adb" >/dev/null 2>&1 || fail 'Instale o ADB no host Linux e permita seu uso pelo usuário do runner.'
command -v timeout >/dev/null 2>&1 || fail 'O comando timeout (coreutils) é necessário.'
command -v sha256sum >/dev/null 2>&1 || fail 'O comando sha256sum (coreutils) é necessário.'

device() { timeout --signal=TERM --kill-after=5s 20s "$adb" -s "$serial" "$@"; }
if ! state=$(device get-state 2>/dev/null) || [[ ${state//$'\r'/} != device ]]; then
  pending 'Tablet desconectado, offline ou sem autorização USB. Reconecte e autorize o usuário do runner.'
fi
if ! transport=$(device get-devpath 2>/dev/null) || [[ ${transport//$'\r'/} != usb:* ]]; then
  fail 'O dispositivo configurado não está acessível por transporte USB.'
fi

base_apk() {
  local paths
  paths=$(device shell pm path "$package") || return 1
  paths=${paths//$'\r'/}
  # This application is distributed as one APK, not a set of split APKs.
  [[ "$paths" =~ ^package:(/[A-Za-z0-9_./=+~-]+/base\.apk)$ ]] || return 1
  printf '%s' "${BASH_REMATCH[1]}"
}
base_apk >/dev/null || fail 'SmartFrame não está instalado neste tablet. Faça a instalação e o pareamento iniciais manualmente.'

# Android enforces the existing package signature. Do not uninstall, clear data or allow downgrade.
if ! output=$(timeout --signal=TERM --kill-after=5s 180s "$adb" -s "$serial" install -r "$apk" 2>&1); then
  printf '%s\n' "$output" >&2
  fail 'Instalação recusada ou interrompida. Confira conexão, assinatura e versionCode; o app não foi desinstalado.'
fi
printf '%s\n' "$output"
grep -Fxq Success <<< "${output//$'\r'/}" || fail 'O ADB não confirmou a instalação.'

# Compare the installed bytes rather than versionName: debug APKs may reuse the same versionCode.
installed=$(base_apk) || fail 'Não foi possível localizar o APK instalado após a atualização.'
tmp=$(mktemp -d "${TMPDIR:-/tmp}/smartframe-tablet.XXXXXX")
trap 'rm -f -- "$tmp/installed.apk"; rmdir -- "$tmp"' EXIT
if ! timeout --signal=TERM --kill-after=5s 60s "$adb" -s "$serial" pull "$installed" "$tmp/installed.apk"; then
  fail 'Não foi possível verificar o APK instalado.'
fi
expected=$(sha256sum -- "$apk")
actual=$(sha256sum -- "$tmp/installed.apk")
[[ ${expected%% *} == "${actual%% *}" ]] || fail 'O APK instalado não corresponde ao APK deste deploy.'

if ! output=$(device shell am start -W -n "$package/.MainActivity" 2>&1); then
  printf '%s\n' "$output" >&2
  fail 'APK atualizado, mas não foi possível abrir o SmartFrame.'
fi
printf '%s\n' "$output"
if grep -Eiq 'Error:|Exception|Error type|Status: timeout' <<< "$output"; then
  fail 'APK atualizado, mas o Android recusou a abertura do SmartFrame.'
fi
if ! pid=$(device shell pidof "$package") || [[ ! ${pid//$'\r'/} =~ ^[0-9]+(\ [0-9]+)*$ ]]; then
  fail 'APK atualizado, mas o processo do SmartFrame não está em execução.'
fi
summary "Tablet $serial: APK deste deploy instalado e SmartFrame reaberto, sem apagar dados ou pareamento. A aplicação do painel é confirmada separadamente pelo player."
