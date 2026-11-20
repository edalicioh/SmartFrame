# Agentes e skills do SmartFrame (Antigravity / Orca)

As definições nesta pasta seguem o padrão nativo do Google Antigravity (`.agents/agents/` e `.agents/skills/`) e são descobertas automaticamente no workspace sem alterar o agente padrão global da sua instalação.

> Adaptado e expandido a partir de `.opencode/` (mantida intacta para compatibilidade com OpenCode) para aproveitar os recursos de orquestração do Antigravity (`invoke_subagent`, `define_subagent`, `swarm`, `run_workflow`, `ask_question`, `research` e `browser`).

## Agentes principais (`/agents`)

Selecione no painel `/agents` do Antigravity CLI ou no seletor de agentes da interface:

- `smartframe-orchestrator`: **maestro de orquestração**. Analisa a demanda, mapeia o código com `research`, esclarece decisões com `ask_question`, divide o trabalho sem colisão de arquivos e distribui entre executores, revisores e pipeline de entrega via `invoke_subagent`, `swarm` ou `run_workflow`.
- `smartframe`: desenvolvedor principal full-stack (também invocável como subagente), equipado com todas as skills do projeto e capacidade de delegação.
- `smartframe-release-ops`: commits solicitados, deploys explicitamente autorizados e acompanhamento pontual de workflows/serviços via `gh` (`subagent: true`, `commandExecutionPolicy: off`).

## Subagentes executores (`mainAgent: false`, `subagent: true`)

Acionados pelo `smartframe-orchestrator` (ou `smartframe`) via `invoke_subagent` ou `run_workflow`:

- `smartframe-web-dev`: `packages/contracts`, `packages/widgets`, `packages/frames`, `apps/web` e testes web/contratos.
- `smartframe-player-dev`: `smartframe-player/`, `apps/android/` e testes do player.
- `smartframe-dados-dev`: `packages/database/`, `packages/jobs/`, `apps/worker/`.

## Subagentes de revisão interna somente leitura (`commandExecutionPolicy: off`)

- `smartframe-web-review`: editor, APIs, contratos e isolamento (`model: flash`).
- `smartframe-player-review`: dashboard web, Android e rede (`model: flash`).
- `smartframe-security-review`: segurança, dados e migrations (`model: inherit`).

## Subagentes de pipeline externo (`mainAgent: false`, `subagent: true`)

Acionados pelo `smartframe-orchestrator` após a validação local (`smartframe-entrega-pipeline`):

- `smartframe-codex-review`: executa code review externo via Codex CLI (`gpt-6.2-sol`) em loop de no máximo 3 rodadas (parada obrigatória até segunda ordem caso não aprove após a 3ª rodada).
- `smartframe-docs-changelog`: atualiza documentação (`docs/`, `README.md`) e `CHANGELOG.md` via OpenCode CLI com DeepSeek (`opencode/deepseek-v4.1-flash-free`, fallback `nvidia/deepseek-ai/deepseek-v4.1-flash`) somente após aprovação do Codex.

## Fluxo de entrega orquestrado

1. **Implementação + Validação local** (`smartframe-*-dev` / `smartframe` + `smartframe-validacao` + revisores internos).
2. **Gate 1 — Loop Codex (`gpt-6.2-sol`)** via `smartframe-codex-review` (máx. 3 rodadas; se falhar na 3ª, **para tudo até segunda ordem**).
3. **Gate 2 — Documentação & `CHANGELOG.md`** via `smartframe-docs-changelog` (OpenCode DeepSeek, somente após aprovação do Gate 1).
4. **Gate 3 — Commit & Monitoramento GitHub Actions** via `smartframe-release-ops` (`git push` para `main` requer autorização explícita conforme `AGENTS.md`, seguido de `gh run watch` / `gh run view` em `.github/workflows/deploy.yml`).

> **Nota técnica sobre `tools`:** o campo `tools` foi intencionalmente omitido no frontmatter dos subagentes porque a documentação do Antigravity registra um problema conhecido em que nomes de ferramentas não mapeados entre CLI e App podem travar o subagente. O modo somente leitura dos revisores é garantido por `commandExecutionPolicy: off` e pelas restrições explícitas no `# System Prompt`.

## Distribuição de modelos

- `smartframe-orchestrator`, `smartframe`, `smartframe-release-ops`, `smartframe-*-dev` e `smartframe-security-review`: `inherit` (usa o modelo/Orquestrador selecionado na sessão, como *Orchestrator (Argon)* ou *Gemini 4 Hydrogen*).
- `smartframe-web-review`, `smartframe-player-review`, `smartframe-codex-review` e `smartframe-docs-changelog`: `flash` (triagem rápida e orquestração das CLIs externas `codex` e `opencode`).

## Skills (`/skills`)

Descobertas automaticamente em `.agents/skills/*/SKILL.md` (execute `/skills reload` na CLI se editar durante uma sessão aberta):

- `smartframe-orquestracao`: regras de escolha entre `invoke_subagent`, `swarm` e `run_workflow` + particionamento seguro de arquivos no SmartFrame.
- `smartframe-entrega-pipeline`: gates de entrega (loop Codex `gpt-6.2-sol` máx. 3x, OpenCode DeepSeek para docs/changelog e commit/monitoramento `gh`).
- `smartframe-editor`: editor, contratos, publicação e widgets.
- `smartframe-player-android`: dashboard, Android e conectividade.
- `smartframe-dados`: SQLite, migrations, worker e preservação de dados.
- `smartframe-validacao`: escolha e relato de verificações.
