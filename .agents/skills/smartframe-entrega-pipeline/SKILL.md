---
name: smartframe-entrega-pipeline
description: Pipeline de entrega do SmartFrame após implementação: loop contínuo de code review via Codex (gpt-6.2-sol) até aprovação, documentação e changelog via OpenCode DeepSeek, e commit/monitoramento do deploy no GitHub Actions.
---

# Pipeline de Entrega — SmartFrame

Este pipeline padroniza os gates após a implementação e validação local para entregas no SmartFrame. Nunca leia nem envie `.env`, chaves privadas, segredos ou dados reais em prompts, diffs ou logs.

## Pré-requisito (antes do Gate 1)

1. Execute e confirme as validações locais proporcionais à mudança seguindo `smartframe-validacao` (`npm run check`, `npm run test:player`, `vitest` direcionado, etc.).
2. Identifique exatamente os arquivos da tarefa com `git status --short` para não misturar trabalho preexistente não relacionado.

---

## Gate 1 — Code Review externo via Codex (`gpt-6.2-sol`)

Submeta as alterações ao Codex CLI (`codex-cli 0.171.0`) usando obrigatoriamente o modelo `gpt-6.2-sol` (delegue ao subagente `smartframe-codex-review`).

### Comandos verificados

- **Escopo delimitado** (quando houver alterações preexistentes não relacionadas no working tree, ou para enviar instruções detalhadas de revisão):
  ```powershell
  codex exec -m gpt-6.2-sol -s read-only --ephemeral "<prompt com lista exata de arquivos/diff da tarefa exigindo veredito APPROVED ou CHANGES_REQUESTED e achados com severidade, arquivo e linha>"
  ```
- **Todo o working tree ou branch dedicada** (sem instruções customizadas combinadas com `--uncommitted`):
  ```powershell
  codex exec review -m gpt-6.2-sol --ephemeral --uncommitted
  ```
  (ou `--base main` quando comparar contra a branch base; caso `codex exec review` recuse combinar flags com prompt customizado, use `codex exec -m gpt-6.2-sol -s read-only --ephemeral`).

### Fluxo do loop (`rodada = 1, 2, ...` até `APPROVED`)

1. Submeta ao Codex (`gpt-6.2-sol`) e aguarde o retorno completo.
2. **Se `APPROVED`** (sem achados bloqueantes): encerre o Gate 1 e avance para o Gate 2.
3. **Se `CHANGES_REQUESTED`**:
   - Corrija todos os achados reportados (delegando ao especialista adequado — `smartframe-web-dev`, `smartframe-player-dev`, `smartframe-dados-dev` ou `smartframe` — quando usar subagentes).
   - Reexecute as validações pertinentes (`smartframe-validacao`).
   - Incremente `rodada` e resubmeta ao Codex, iterando continuamente até obter `APPROVED`.
4. **Parada apenas em bloqueio real**:
   - Pare e acione o coordenador/proprietário somente em caso de bloqueio técnico externo irrecuperável (ex.: erro recorrente de autenticação, cota ou falha do CLI `codex`) ou dúvida de produto/decisão arquitetural que exija resposta do proprietário.
   - Enquanto houver achados técnicos corrigíveis, **não** interrompa em teto fixo de rodadas e não avance para Gate 2, commit, push ou deploy antes de obter `APPROVED`.

---

## Gate 2 — Documentação e Changelog via OpenCode DeepSeek

> **Pré-condição absoluta:** executar **somente se** o Gate 1 terminou com `APPROVED`.

Delegue ao subagente `smartframe-docs-changelog` para acionar o OpenCode CLI (`v2.3.0`) com DeepSeek:

### Comandos verificados

- **Modelo primário:** `opencode/deepseek-v4.1-flash-free`
- **Modelo fallback** (se houver rate limit ou indisponibilidade do gratuito): `nvidia/deepseek-ai/deepseek-v4.1-flash`
- **Execução não-interativa:**
  ```powershell
  opencode run -m opencode/deepseek-v4.1-flash-free --archived --auto "<prompt escopado com resumo aprovado e lista de arquivos alterados>"
  ```

### Escopo estrito e pós-validação

- Atualizar apenas documentação pertinente em `docs/` (ex.: `docs/API.md`, `docs/WIDGETS.md`, `docs/OPERATIONS.md`, `docs/PERSONALIZATION.md`, `README.md` quando aplicável) refletindo estritamente o que foi implementado no código.
- Criar ou atualizar `CHANGELOG.md` na raiz do repositório (padrão *Keep a Changelog*, sob `## [Unreleased]` ou seção datada com `Added`, `Changed`, `Fixed`, `Security`).
- **Proibido ao OpenCode:** editar código-fonte, testes, migrations, workflows ou `.env`.
- **Conferência obrigatória pós-execução:** rode `git status --short` e `git diff` para confirmar que apenas documentação e `CHANGELOG.md` foram modificados e que não há segredos ou edições fora do escopo.

---

## Gate 3 — Commit, Push e Monitoramento do Deploy no GitHub Actions

> **Pré-condição absoluta:** Gates 1 (`APPROVED`) e 2 (documentação/changelog validados) concluídos.

Delegue ao agente `smartframe-release-ops` seguindo `AGENTS.md` e `docs/DEPLOY-GITHUB-ACTIONS.md`:

1. **Commit local**:
   - Confira `git status --short`. Faça `git add` explícito apenas dos arquivos da tarefa (código, testes, docs e `CHANGELOG.md`) — nunca `git add -A` quando houver trabalho preexistente de terceiros.
   - Revise `git diff --cached` para confirmar ausência de `.env`, credenciais ou dados reais.
   - Crie o commit somente quando autorizado pelo usuário.
2. **Push e disparo de deploy (`main`)**:
   - Push para `main` dispara `.github/workflows/deploy.yml` (jobs `checks`, `android` e `deploy` no runner Linux self-hosted `smartframe`, executando `scripts/deploy-server.sh` com backup + migrations + healthcheck e `scripts/update-tablet-usb.sh`).
   - Conforme `AGENTS.md`, **execute `git push` apenas com autorização explícita para publicar/fazer push nesta entrega**. Caso contrário, pare após o commit local e peça confirmação antes do push.
3. **Monitoramento pontual via `gh` (após push autorizado)**:
   - Localize o run correspondente ao commit:
     ```powershell
     gh run list --workflow=deploy.yml --branch main --limit 5 --json databaseId,headSha,status,conclusion,url,createdAt
     ```
   - Acompanhe a conclusão sem usar `sleep` em shell:
     ```powershell
     gh run watch <run-id> --exit-status
     ```
   - Inspecione os jobs e resultados:
     ```powershell
     gh run view <run-id> --json status,conclusion,jobs,url
     ```
   - Em caso de falha, inspecione sem expor valores sensíveis:
     ```powershell
     gh run view <run-id> --log-failed
     ```
     Não execute rollback ou restauração automática sem autorização explícita.
   - Relate ID/URL do run, commit SHA e status por job (`checks`, `android`, `deploy` e atualização USB), diferenciando healthcheck do servidor de validação visual física no tablet.
