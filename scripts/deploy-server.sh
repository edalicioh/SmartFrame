#!/usr/bin/env bash
set -euo pipefail

# O runner usa somente os caminhos definidos aqui, fora do checkout do Actions.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
env_file=${SMARTFRAME_ENV_FILE:-/etc/smartframe/deploy.env}
backup_dir=${SMARTFRAME_BACKUP_DIR:-/var/backups/smartframe}
volume=smartframe_smartframe_data
revision=${GITHUB_SHA:-local}

if [[ ! -f "$env_file" || ! -r "$env_file" ]]; then
  echo "Arquivo de ambiente inexistente ou inacessível: $env_file" >&2
  exit 1
fi
if [[ ! -d "$backup_dir" || "$backup_dir" != /* ]]; then
  echo "O diretório absoluto de backups deve existir: $backup_dir" >&2
  exit 1
fi
if [[ ! "$revision" =~ ^([0-9a-fA-F]{40}|local)$ ]]; then
  echo "Revisão de deploy inválida." >&2
  exit 1
fi

# Variáveis herdadas teriam precedência sobre --env-file no Compose.
for name in BETTER_AUTH_SECRET BETTER_AUTH_URL SMARTFRAME_ADMIN_LOGIN SMARTFRAME_ADMIN_EMAIL SMARTFRAME_ONLINE_HOUSEHOLD_ID SMARTFRAME_BIND SMARTFRAME_PORT; do
  if [[ -v "$name" ]]; then
    echo "A variável $name não deve estar no ambiente do runner; use $env_file." >&2
    exit 1
  fi
done

compose=(docker compose --project-name smartframe --env-file "$env_file" -f "$root/compose.yaml")
"${compose[@]}" config --quiet
if ! docker volume inspect "$volume" >/dev/null 2>&1; then
  echo "Volume $volume não encontrado. Prepare ou importe os dados antes do deploy." >&2
  exit 1
fi

# Constrói antes de interromper a versão atual. O Compose compartilha esta imagem.
"${compose[@]}" build web

# O volume deve ser exclusivo desta instalação. Todos os seus consumidores devem
# estar parados para que o backup inclua um estado consistente de SQLite e mídia.
"${compose[@]}" stop nginx web worker
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="smartframe-${stamp}-${revision:0:12}.tar.gz"
echo "Criando backup $backup_dir/$archive"
docker run --rm --user 0 \
  --mount "type=volume,source=$volume,target=/data,readonly" \
  --mount "type=bind,source=$backup_dir,target=/backup" \
  smartframe:local sh -eu -c '
    umask 077
    if [ -e "/backup/$1" ] || [ -e "/backup/$1.partial" ]; then
      echo "O arquivo de backup já existe; deploy cancelado." >&2
      exit 1
    fi
    tar -czf "/backup/$1.partial" -C /data .
    tar -tzf "/backup/$1.partial" >/dev/null
    mv "/backup/$1.partial" "/backup/$1"
  ' sh "$archive"

# Uma falha de backup ou migration interrompe o deploy; nunca apaga o volume.
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" up -d --no-deps web worker

web_id=$("${compose[@]}" ps -q web)
worker_id=$("${compose[@]}" ps -q worker)
if [[ -z "$web_id" || -z "$worker_id" ]]; then
  echo "Container web ou worker não encontrado após iniciar." >&2
  exit 1
fi
ready=false
for ((attempt = 0; attempt < 36; attempt++)); do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$web_id")
  if [[ "$health" == healthy ]]; then
    ready=true
    break
  fi
  if [[ "$health" == unhealthy || "$health" == exited || "$health" == dead ]]; then
    break
  fi
  sleep 5
done
if [[ "$ready" != true ]]; then
  echo "O serviço web não ficou saudável; o nginx não foi iniciado. Verifique os logs e o backup." >&2
  exit 1
fi
if [[ $(docker inspect --format '{{.State.Status}}' "$worker_id") != running ]]; then
  echo "O worker não está em execução; o nginx não foi iniciado." >&2
  exit 1
fi
"${compose[@]}" up -d --no-deps --force-recreate nginx
"${compose[@]}" ps
echo "Deploy concluído. Backup: $backup_dir/$archive"
