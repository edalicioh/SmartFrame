# Fase 04 — revisão

Responsável: Sol-6.1 (`smartframe-web-review` e `smartframe-security-review`, revisões independentes somente leitura) e Gate 1 externo (Codex CLI `gpt-6.2-sol`)
Data: 2026-11-23 / 2026-11-24
Referência: alterações locais sem commit sobre `f3ddc04`.
Escopo: Fase 04 (Visão geral baseada no uso real).

**Veredito interno (Sol-6.1):** **APROVADA** (escopo web revalidado após correção integral dos achados da Rodada 1 do Codex; validação física em tablet/APK e leitor de tela permanecem explicitamente pendentes).

---

## Revisões internas iniciais (2026-11-23)

- **Segurança (`smartframe-security-review`):** **APROVADO** (0 críticos, 0 altos, 0 médios; 1 observação informativa aplicada sobre sanitização de `activePanelId`).
- **Web e Contratos (`smartframe-web-review`):** **APROVADA** (0 críticos, 0 altos, 0 médios; 3 observações baixas aplicadas sobre `groupBy`, `flex-wrap` em `800px` e cobertura unitária).

---

## Gate 1 — Rodada 1 (Codex CLI `gpt-6.2-sol`, 2026-11-24)

- **Veredito da Rodada 1:** `CHANGES_REQUESTED` (1 High, 6 Medium, 1 Low).
- **Achados e ações executadas:**
  1. **[High] `api/online-frame/route.ts` / `online-frame-editor.tsx`:** busca legada por `key` sem filtro `householdId` e retorno do rascunho completo na checagem de status. **Corrigido:** filtro obrigatório por `householdId` na consulta de `layout` e validação de `layoutVersion` (`layoutId === layout.id`), além de parâmetro `?summary=1` usado pelo editor para não ler nem retornar `draft`/`config`, coberto por teste de regressão em `tests/multiple-panels.test.ts`.
  2. **[Medium] `overview-data.ts`:** leituras de relações aninhadas (`activePanel`/`activePanelVersion`) executando `IN (...)` no banco sem `householdId`. **Corrigido:** substituído por carregamento em lote explícito de `Layout` e `LayoutVersion` filtrado por `householdId` e elegibilidade (`panel:`/`online:`).
  3. **[Medium] `overview-data.ts` / `overview.ts`:** versão legada `publishedVersionId` inconsistente podendo parecer confirmada/ativa e rótulo genérico no lugar do nome validado do painel legado. **Corrigido:** validação de `LayoutVersion.layoutId === layout.id` também para fallback legado, exibição do nome validado do painel legado no cartão e novo teste de regressão em `tests/online-editor-overview.test.ts`.
  4. **[Medium] `page.tsx` / `photo-library.tsx` / `online-frame-editor.tsx`:** atalho da biblioteca apontava para `/layouts` sem painel e o editor ocultava controles de foto sem painel selecionado. **Corrigido:** link da biblioteca passa `?panelId=...` quando há painel e, quando não há painéis, `OnlineFrameEditor` exibe `PhotoLibrary` em modo independente (`allowSelection={false}`) com upload e listagem funcionais.
  5. **[Medium] `overview-data.ts`:** orientação de dispositivos sem painel ou pendentes restrita aos 12 cartões exibidos. **Corrigido:** avaliação de status e seleção de alvo executadas sobre todos os dispositivos não revogados da família em lote, com teste cobrindo 12 dispositivos confirmados + dispositivos acionáveis fora do limite.
  6. **[Medium] `globals.css`:** contraste insuficiente na navegação lateral (`~3.83:1`) e contagens/pílulas (`~2.81:1`). **Corrigido:** tokens escurecidos para >= 4,5:1, com medição em Chromium de `7.46:1` (`.nav-item` / `.nav-count`) e `7.95:1` (`.pill`).
  7. **[Medium] `phase04-browser-report.json` / `fase-04-revisao.md`:** evidência anterior não registrava fluxo completo por teclado (`Tab`/`Enter`) nem verificação visual de `/login` e `error.tsx`. **Corrigido:** bateria expandida para 16 checagens em `1440×1000` e `390×844` incluindo teclado + foco visível (`solid 3px`), `/login`, `/not-found` e `error.tsx` real com SQLite não migrado.
  8. **[Low] `overview.ts` / `publication.ts`:** divergência de fuso entre servidor (UTC) e navegador. **Corrigido:** `formatLastCommunication` padronizado com `timeZone` explícito (`device.timezone` ou `America/Sao_Paulo`) e `timeZoneName: "short"` em `/` e `/layouts`.

---

## Gate 1 — Rodada 2 (Codex CLI `gpt-6.2-sol`, 2026-11-24)

- **Veredito da Rodada 2:** `CHANGES_REQUESTED` (0 críticos, 0 altos, 5 médios, 1 baixo).
- **Achados e ações executadas:**
  1. **[Medium] `apps/web/src/app/api/devices/route.ts` / `apps/web/src/components/online-frame-editor.tsx`:** parâmetro `deviceId` na URL de `/layouts` falhava com fallback de "não encontrado" caso o dispositivo estivesse além do limite de 100 dispositivos retornado por `GET /api/devices`. **Corrigido:** `GET /api/devices` passou a aceitar `?includeId=<id>` opcional (validando `householdId` e `revokedAt: null`), o editor inclui `includeId` na busca quando necessário e `tests/multiple-panels.test.ts` ganhou teste de regressão com >100 dispositivos.
  2. **[Medium] `apps/web/src/lib/overview-data.ts`:** múltiplas consultas separadas na visão geral sem snapshot único podiam exibir combinação incoerente sob publicação ou alteração concorrente. **Corrigido:** consultas agrupadas em `database.$transaction` (`queryOverviewSnapshot`) com teste de consistência concorrente em `tests/online-editor-overview.test.ts`.
  3. **[Medium] `apps/web/src/lib/overview-data.ts` / `apps/web/src/lib/online-editor/overview.ts`:** validação de `publishedVersionId` do próprio painel (`Layout.publishedVersionId`) faltava ao calcular `hasPublishedVersion` na visão geral. **Corrigido:** `hasPublishedVersion` verifica explicitamente se `publishedVersionId` corresponde a uma versão válida do próprio painel no snapshot.
  4. **[Medium] `packages/auth/src/local-panel.ts` / `apps/web/src/lib/session.ts` / `apps/web/src/app/layouts/page.tsx`:** redirecionamento entre aliases de loopback no modo local descartava `pathname` e `?panelId=...&deviceId=...` em `/layouts`. **Corrigido:** `localPanelRedirect` aceita target completo normalizado (exigindo caminho começando com `/` e não `//`), `requireAdministrator` e `/layouts` encaminham `/layouts?panelId=...&deviceId=...`, coberto por `tests/local-panel.test.ts` e Chromium (`local_mode_alias_redirect_preserves_context`).
  5. **[Medium] `apps/web/src/app/globals.css` / `apps/web/src/app/editor.css`:** anel `:focus-visible` (`#7ba979` / `var(--accent)`) com contraste < 3:1 sobre superfícies claras. **Corrigido:** `:focus-visible` ajustado para `#2b593f` sobre fundos claros (e `#eff2df` em `.welcome-banner`), medido no Chromium em `7.84:1` (cartão de atalho) e `3.98:1` (link de retorno).
  6. **[Low] `apps/web/src/components/online-frame-editor.tsx` / `apps/web/src/components/online-editor/photo-library.tsx`:** mensagem após upload no modo biblioteca independente sem painel ainda sugeria selecionar a foto para o painel inexistente. **Corrigido:** texto contextual ajustado quando não há painel selecionado.

---

## Validação pós-correções (antes da Rodada 3 do Gate 1)

- `npm run check`: **sucesso** (`eslint .` sem erros; `tsc --noEmit` raiz e `@smartframe/web`; Vitest **29 arquivos / 261 testes aprovados**, sendo 11 em `tests/online-editor-overview.test.ts`, 12 em `tests/multiple-panels.test.ts` e 5 em `tests/local-panel.test.ts`; `npm run test:player` **92 testes aprovados**).
- `npm run build`, `npm run test:smoke`, `npm run test:smoke:local` e `git diff --check`: **sucesso**.
- Chromium headless (`1440×1000` e `390×844`): **17 verificações aprovadas** registradas em [phase04-browser-report.json](evidencias/fase-04/phase04-browser-report.json).

## Limitações e pendências externas

- Teste físico em aparelho **tablet Android/APK** e leitura manual com **leitor de tela** não executados neste ambiente.

---

## Gate 1 — Rodada 3 (Codex CLI `gpt-6.2-sol`, 2026-11-24)

- **Veredito da Rodada 3:** `CHANGES_REQUESTED` (0 críticos, 0 altos, 3 médios, 3 baixos). Regra anterior de parada obrigatória na 3ª rodada removida por decisão do proprietário.
- **Achados reportados e ações executadas:**
  1. `[MEDIUM] apps/web/src/components/online-frame-editor.tsx:1125` — Atualização de `/api/devices` em curso iniciada com outro alvo podia limpar seleção para dispositivo incluído fora dos 100 iniciais se o usuário voltasse a ele antes da resposta. **Corrigido:** `refreshDevices` verifica se o alvo mudou durante a requisição (`shouldRetryDeviceListRefresh`) e refaz a busca com `?includeId=<target>` antes de aplicar ou limpar a seleção, coberto por teste unitário.
  2. `[MEDIUM] tests/online-editor-overview.test.ts:779` — Teste de concorrência passava mesmo sem `$transaction` por alterar apenas o dispositivo já lido antes das consultas seguintes. **Corrigido:** teste passou a usar conexão SQLite separada alterando `Layout.name` após a 1ª leitura (`panelRows`) e antes de `relatedPanels`, validando explicitamente que o fluxo sem `$transaction` falha com divergência e o fluxo com `$transaction` preserva snapshot coerente.
  3. `[MEDIUM] apps/web/src/lib/overview-data.ts:334` / `apps/web/src/app/page.tsx:407` — Painel legado disponibilizado com `publishOnlinePanel` (`activate: false`) aparecia como "Somente rascunho" e painéis publicados sem envio ativo exibiam selo "Rascunho". **Corrigido:** `queryOverviewSnapshot` consulta `devicePanelAccess` válido da família, `mapOverviewPanelCard` e `page.tsx` distinguem **Rascunho**, **Publicado** (`hasPublishedVersion`), **Disponibilizado** (`availableDeviceCount > 0`) e **N ativo** (`activeDeviceCount > 0`), coberto em `tests/online-editor-overview.test.ts` e Chromium.
  4. `[LOW] apps/web/src/components/online-frame-editor.tsx:2531` — Biblioteca independente (`!panelId`) perdia o aviso e o botão `"Atualizar fotos"` após timeout de 90s. **Corrigido:** bloco extraído em `photoPollExpiredCallout` compartilhado entre modo com e sem painel.
  5. `[LOW] packages/auth/src/local-panel.ts:42` — Validar também a origem da URL resolvida em `localPanelRedirect`. **Corrigido:** bloqueio de `/\` além de `//` e validação explícita `resolved.origin === origin.origin`, com testes adicionais em `tests/local-panel.test.ts`.
  6. `[LOW] docs/ui-ux/registros/evidencias/fase-04/phase04-browser-report.json:117` e `docs/ui-ux/registros/fase-04-execucao.md:51` — Divergência de contraste do link de retorno, identificação de cores no banner e upload sem painel no JSON, e direção de redirecionamento (`localhost` -> `127.0.0.1`). **Corrigido:** `.editor-back` ajustado para `#4a5a4e` (`7,33:1` sobre branco), `.photo-upload:focus-within` para `#2b593f`, script Chromium atualizado com walked-up `opaqueSurface`, upload real sem painel (`"1 foto enviada..."`) e foco no `.welcome-banner` (`rgb(239, 242, 223)` sobre `rgb(44, 76, 57)` = `8,38:1`), e direção documentada corretamente em `fase-04-execucao.md`.

---

## Gate 1 — Rodada 4 (Codex CLI `gpt-6.2-sol`, 2026-11-24)

- **Veredito da Rodada 4:** `CHANGES_REQUESTED` (0 críticos, 0 altos, 1 médio, 2 baixos).
- **Achados reportados e ações executadas:**
  1. `[MEDIUM] apps/web/src/lib/overview-data.ts:373` — Painel legado publicado para outro tablet com `activate: false` voltava a aparecer como **Rascunho** após remoção do `devicePanelAccess`, apesar da `LayoutVersion` publicada permanecer no banco com `publishedVersionId` nulo. **Corrigido:** `queryOverviewSnapshot` consulta `panelIdsWithAnyVersion` em `LayoutVersion` própria do painel (`layoutId IN displayedPanelIds`), preservando o estado **Publicado** após revogação do acesso sem ativar fallback indevido, com teste de transição **Disponibilizado** -> **Publicado** em `tests/online-editor-overview.test.ts`.
  2. `[LOW] apps/web/src/lib/online-editor/overview.ts:207` — Quando um painel legado estava ativo por fallback no tablet A (contagem `1`) e disponibilizado no tablet B (contagem `1`), o cartão exibia apenas o envio ativo. **Corrigido:** `overview-data.ts` compara conjuntos de IDs (`availableIds` vs `activeIds`) e repassa `extraAvailableDeviceCount`, exibindo `"Enviado para 1 dispositivo · disponibilizado em mais 1 dispositivo"`, coberto em `tests/online-editor-overview.test.ts`.
  3. `[LOW] docs/ui-ux/registros/evidencias/fase-04/phase04-browser-report.json:134` — O relatório atribuía ao contorno de foco do link de retorno a cor do texto (`#4a5a4e` / `7,33:1`) em vez do contorno real (`#2b593f` / `8,07:1`). **Corrigido:** adicionada regra explícita `.editor-back:focus-visible` em `editor.css`, aguardada estabilização após `Tab` no script Chromium e separados os blocos `text` (`rgb(74, 90, 78)`, `7,33:1`) e `focusOutline` (`rgb(43, 89, 63)`, `8,07:1`) em ambos os viewports.

---

## Gate 1 — Rodada 5 (Codex CLI `gpt-6.2-sol`, 2026-11-24)

- **Veredito da Rodada 5:** `CHANGES_REQUESTED` (0 críticos, 0 altos, 1 médio, 1 baixo).
- **Achados reportados e ações executadas:**
  1. `[MEDIUM] apps/web/src/lib/overview-data.ts:158` — A consulta `IN` de chaves legadas (e demais cláusulas `IN` sobre dispositivos/versões da família) podia ultrapassar o limite de parâmetros do SQLite com >= 999 dispositivos. **Corrigido:** consultas `IN` em `queryOverviewSnapshot` fatiadas por `queryInChunks` em blocos de até `250` itens mantendo escopo estrito de família (`householdId`) e transação única, com teste de regressão de 1050 dispositivos em `tests/online-editor-overview.test.ts`.
  2. `[LOW] tests/online-editor-overview.test.ts:317` — Asserção duplicada de `mapOverviewPanelCard` nos testes unitários de `shouldRetryDeviceListRefresh`. **Corrigido:** duplicações removidas mantendo uma asserção unitária e o cenário completo de integração com dois tablets.

---

## Validação pós-correções (Rodada 6 do Gate 1)

- `npm run check`: **sucesso** (`eslint .` sem erros; `tsc --noEmit` raiz e `@smartframe/web`; Vitest **29 arquivos / 263 testes aprovados**, sendo 13 em `tests/online-editor-overview.test.ts`, 12 em `tests/multiple-panels.test.ts` e 5 em `tests/local-panel.test.ts`; `npm run test:player` **92 testes aprovados**).
- `npm run build`, `npm run test:smoke`, `npm run test:smoke:local` e `git diff --check`: **sucesso**.
- Chromium headless (`1440×1000` e `390×844`): **17 verificações aprovadas** registradas em [phase04-browser-report.json](evidencias/fase-04/phase04-browser-report.json).

---

## Gate 1 — Rodada 6 (Codex CLI `gpt-6.2-sol`, 2026-11-24)

- **Veredito da Rodada 6:** **`APPROVED`** (0 críticos, 0 altos, 0 médios, 1 observação baixa não bloqueante).
- **Resumo verificado pelo Codex:** confirmou o fatiamento das quatro consultas `IN` em blocos de até 250 itens dentro de `$transaction` preservando filtros de família/elegibilidade (testado inclusive em SQLite em memória com 2.100 dispositivos sintéticos), a remoção das asserções duplicadas em `tests/online-editor-overview.test.ts`, a coerência das contagens (`29 arquivos / 263 testes`, `13` em `tests/online-editor-overview.test.ts`) e a remoção da regra de parada na 3ª rodada em `.agents/`.
- **Observação não bloqueante:**
  - `[LOW] tests/online-editor-overview.test.ts:1001` — O teste de carga com 1.050 dispositivos na suíte exercita o fatiamento das chaves legadas `online:*` (dispositivos sem painel ativo), enquanto o cenário independente em memória validou as quatro consultas fatiadas.
- **Próximo passo:** Gate 2 (`smartframe-docs-changelog` via OpenCode DeepSeek) e devolução para aprovação final antes de commit/push.
