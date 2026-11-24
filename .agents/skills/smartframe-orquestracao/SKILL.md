---
name: smartframe-orquestracao
description: Use ao decompor tarefas complexas do SmartFrame, distribuir frentes paralelas entre subagentes ou swarm, rodar fan-outs com run_workflow e coordenar revisão e validação integradas.
---

# Playbook de Orquestração — SmartFrame

## 1. Escolha do poder certo no Antigravity

| Cenário | Mecanismo | Configuração recomendada |
| :--- | :--- | :--- |
| Mapeamento rápido de código/rotas/contratos | `invoke_subagent` (`research`) | `Workspace: "inherit"` (somente leitura) |
| Tarefa focada em 1 camada ou revisão pontual | `invoke_subagent` | `smartframe-web-dev`, `smartframe-player-dev`, `smartframe-dados-dev` ou revisores |
| Função multi-camada com colaboração e verificação contínua | `swarm` | `workspace: "share"` para quem edita em paralelo + `@verifier` |
| Mesma verificação/edição em N arquivos ou loop revisor→corretor | `run_workflow` | Script Python com `parallel` / `pipeline`, `schema` JSON e `workspace="share"` se editar |
| Papel inédito fora da lista fixa | `define_subagent` + `invoke_subagent` | Escopo e restrições explícitas |
| Decisão de produto/arquitetura ambígua | `ask_question` | Pergunte antes de distribuir trabalho |
| Inspeção visual de editor ou player em execução | `invoke_subagent` (`browser`) | Quando houver servidor local/URL disponível |
| Code review externo (Codex `gpt-6.2-sol`) | `invoke_subagent` (`smartframe-codex-review`) | Gate 1 de `smartframe-entrega-pipeline` (iterar até `APPROVED`, parando só por bloqueio técnico/dúvida de produto) |
| Documentação e `CHANGELOG.md` (OpenCode DeepSeek) | `invoke_subagent` (`smartframe-docs-changelog`) | Gate 2 de `smartframe-entrega-pipeline` (somente após `APPROVED` do Codex) |
| Commit, push autorizado e monitoramento `gh` | `invoke_subagent` (`smartframe-release-ops`) | Gate 3 de `smartframe-entrega-pipeline` (respeitando `AGENTS.md`) |

## 2. Particionamento seguro de arquivos (evitar colisões)

Ao distribuir trabalho paralelo no SmartFrame, nunca atribua o mesmo arquivo a dois agentes escrevendo simultaneamente:

1. **Contratos primeiro (`packages/contracts/src/`, `packages/widgets/src/`)**: se a tarefa altera schemas Zod ou tipos compartilhados, faça o contrato antes (sequencial ou dono único) e só depois dispare `apps/web` e `smartframe-player` em paralelo.
2. **Dono de Web/API (`smartframe-web-dev`)**: `apps/web/`, `packages/frames/`, `tests/` web/contratos.
3. **Dono de Player/Android (`smartframe-player-dev`)**: `smartframe-player/`, `apps/android/`. Lembre-se de rodar `npm run player:sync` após integrar mudanças no player (e nunca editar `apps/web/public/player*` manualmente).
4. **Dono de Dados/Worker (`smartframe-dados-dev`)**: `packages/database/`, `packages/jobs/`, `apps/worker/`.
5. **Revisão paralela somente leitura**: dispare `smartframe-web-review`, `smartframe-player-review` e `smartframe-security-review` após as edições, com lista exata de arquivos modificados.

## 3. Consolidação e encerramento

- Se usar `swarm` com `workspace: "share"` ou `"branch"`, garanta que as alterações dos workers sejam trazidas para o workspace principal antes de executar `kill`.
- Nunca presuma que um subagente rodou todos os testes; execute ou delegue a validação final seguindo `smartframe-validacao` (`npm run check`, `npm run test:player`, `vitest` direcionado) após a integração.
- Para entregas completas (review externo → docs/changelog → commit/deploy), siga os 3 gates de `smartframe-entrega-pipeline`:
  1. `smartframe-codex-review` (`gpt-6.2-sol`, iterando correções e revalidações até obter `APPROVED`; parar apenas em bloqueio técnico externo ou decisão com o proprietário).
  2. `smartframe-docs-changelog` (OpenCode DeepSeek, apenas se aprovado no Gate 1).
  3. `smartframe-release-ops` (commit e monitoramento `gh` de `.github/workflows/deploy.yml`, exigindo autorização explícita antes de `git push` para `main`).
- Respeite rigorosamente `AGENTS.md`: não leia `.env`/segredos, não aplique migrations em banco real, não faça push/deploy/instalação de APK sem autorização explícita.
