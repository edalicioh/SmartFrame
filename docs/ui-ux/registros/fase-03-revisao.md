# Fase 03 — revisão

Responsável: Sol-6.1 (`smartframe-web-review` e `smartframe-security-review`, revisões independentes somente leitura)
Data: 2026-11-23
Referência: alterações locais sem commit sobre `de8f654`.
Escopo: Fase 03 (Publicação segura e dispositivos).

**Veredito interno (Sol-6.1):** **APROVADA** (para o escopo web; validação em aparelho físico tablet/APK permanece explicitamente pendente; revisão externa Gate 1 concluída com decisão de aceite do proprietário — ver seção final).

---

## Primeira rodada — Revisão de Segurança (`smartframe-security-review`)

- **Veredito:** **APROVADO** (0 críticos, 0 altos, 0 médios, 3 baixos).
- **Conferências principais:**
  - Prévia (`iframe` `/player-dashboard/index.html?preview=1` + `postMessage` restrito a `window.location.origin` + `/api/online-frame/widgets` por sessão admin) sem exposição de Bearer de dispositivo.
  - Nenhum `tokenHash`, Bearer, segredo ou código de pareamento vazado em URLs, logs, `postMessage` ou relatórios (`phase03-browser-report.json`).
  - APIs existentes (`panels`, `panels/publish`, `devices`, `devices/[id]`, `devices/panels`, `pairing-code`), `Origin`, `householdId`, `expectedRevision` e isolamento preservados sem alteração de contrato/schema/APK.
  - Seleção de destino e modo no `PublishDialog` sempre explícitas, sem substituição silenciosa de dispositivo.
- **Achados baixos registrados e tratados:**
  1. Polling de 15s podia substituir `state`/`config` após `PUT` (200) + `POST /publish` (409). **Corrigido** exigindo `conflictRef.current?.panelId !== targetPanelId` e `!publishDialogOpenRef.current` antes de substituir o rascunho.
  2. Mensagem 409 duplicada no `PublishDialog`. **Corrigido** evitando duplicação entre `blockingReason` e `dialogError`.
  3. Falta de `encodeURIComponent(device.id)` em `DELETE /api/devices/:id`. **Corrigido**.

---

## Primeira rodada — Revisão Web e Contratos (`smartframe-web-review`)

- **Veredito inicial:** **AJUSTES NECESSÁRIOS** (4 achados médios, 5 baixos).
- **Achados médios:**
  1. `device-manager.tsx`: falha de `DELETE /api/devices/:id` não era exibida dentro do `<dialog>` modal de confirmação de desvinculação.
  2. `publish-dialog.tsx` / `online-frame-editor.tsx`: corrida de foco ao fechar `PublishDialog` pelos atalhos `"Ir para pareamento"` / `"Selecionar dispositivo"`, e retorno de foco fixo em `publishButtonRef` quando aberto pelo `DeviceManager`.
  3. `publish-dialog.tsx`: `setSelectedMode(initialMode)` síncrono dentro de `useEffect` (risco de `react-hooks/set-state-in-effect`).
  4. `online-frame-editor.tsx`: polling de 15s podia sobrescrever `config` e `draftRevision` com `PublishDialog` aberto quando `dirty === false`.
- **Achados baixos:**
  5. Mensagem 409 duplicada dentro do `PublishDialog`.
  6. Polling de pareamento (5s) e `onRefreshDevices`/`onRetryAccess` sem guarda de concorrência/sequência e sem atualizar `access` no refresh manual.
  7. Contradição transitória `"Nenhum painel enviado"` enquanto `panels` ainda carregava.
  8. Fallback de foco pós-desvinculação quando `revokeTriggerRef` desmonta e prioridade de `numericError` ocultando erro de operação em `EditorFeedback`.
  9. `.online-action-bar` sticky podendo sobrepor `.online-preview` ao expandir banner 409 em desktop.

---

## Reavaliação final (`smartframe-web-review`)

- **Veredito:** **APROVADA** (0 achados críticos, altos, médios ou baixos remanescentes).
- **Conferência das correções:**
  - `revokeError` exibido internamente com `role="alert"` no `<dialog>` de desvinculação; fallback de foco para `pairingButtonRef` quando o botão acionador desmonta.
  - `mode` controlado pelo pai (`PublishDialog`), eliminando `setState` síncrono em `useEffect`.
  - `postCloseFocusRef` e `publishReturnFocusRef` garantem redirecionamento de foco sem corrida e retorno dinâmico de foco.
  - `canReplaceDraft` bloqueia substituição por polling durante `publishDialog.open` ou conflito ativo; `PublishTarget` captura `draftRevision` e valida igualdade em `confirmPublish`.
  - `devicesRequestSeq` e `accessRequestSeq` descartam respostas atrasadas; `onRefreshDevices` também atualiza `access`; fallback `"Painel ativo (carregando nome…)"` evita contradição durante carga; `[operationError, numericError]` preserva visibilidade de ambos alertas.
  - `.online-action-bar` em fluxo acima de `.online-grid` elimina sobreposição com `.online-preview`.
  - `tests/online-editor-publication.test.ts` ampliado para 14 testes (incluindo `no-panel`, `other-panel-active` com `otherPanelConfirmed === false` e cenários de fallback legado com `activePanelId === null`).

## Correções pós-rodadas Codex (2026-11-23)

- `apps/web/src/app/api/panels/route.ts` e `apps/web/src/lib/publish-online-panel.ts`: bloqueada a exclusão (`DELETE`, 409) de painel legado `online:<deviceId>` enquanto estiver sendo servido pelo fallback (`activePanelId === null` com `publishedVersionId`); separado o critério de fallback legado preservando `Layout.publishedVersionId` (inclusive `null` em rascunho nunca publicado) ao disponibilizar com `activate: false` ou publicar em outro dispositivo.
- `apps/web/src/lib/active-online-version.ts`, `apps/web/src/app/api/player/config/route.ts` e `apps/web/src/app/api/player/tasks/route.ts`: `activeOnlineVersionWithDevice` retorna juntos o snapshot atualizado de `Device` e a `LayoutVersion` dentro da mesma `$transaction`, usados em `/api/player/config` (inclusive para `pageDirective`, evitando comando `next` obsoleto após troca concorrente de painel); `/api/player/tasks` identifica a `LayoutVersion` mais recente de painéis `online:*` via `ORDER BY "createdAt" DESC, "rowid" DESC LIMIT 1` para manter sincronização de tarefas mesmo quando `publishedVersionId` preserva o fallback.
- `apps/web/src/app/layout.tsx`, `apps/web/src/components/online-editor/history-guard.tsx`, `apps/web/src/components/online-editor/unsaved-draft-context.tsx`, `apps/web/src/components/sign-out.tsx`, `apps/web/src/app/layouts/page.tsx` e `apps/web/src/components/online-frame-editor.tsx`: proteção de alterações não salvas estendida para **Sair da conta** (`SignOut` confirma localmente sem armar janela global de saída, mantém `signingOut` travado enquanto `authClient.signOut()` está em voo e só autoriza `replace` para `/login` via `authorizeSignOutRedirect("/login")` após sucesso sem ser limpo por `setHasUnsavedDraft(false)` antes da navegação, mantendo Back/Forward protegidos) e travessias Back/Forward no App Router (`window.navigation` + `<HistoryGuard />` global em `RootLayout` com pares `(__sfStep, __sfEpoch)` calculando delta apenas entre posições comprovadas da mesma época contígua, tratando `popstate` antes de `hashchange` via `pendingPopFragment` para atribuir passo apenas quando a criação é comprovada por `navigationType === "push"`, aumento de `history.length` ou `hashchange` direto sem `popstate`, mantendo o histórico intermediário preservado ao cancelar salto com `history.go`, preservando `__NA` e `__PRIVATE_NEXTJS_INTERNALS_TREE` via `stampCurrentFragmentEntry` ou `preserveNextMetadataWithoutStep` sem inventar passo falso em recuos preexistentes, restaurando posição desconhecida sem Navigation API via `nativePushState` para a URL/estado do editor sem supor `history.go(1)`, ignorando mudanças puras de fragmento no mesmo documento via `stripUrlFragment`, restaurando via `navigation.traverseTo(restoreKey)` ou delta de índice quando a Navigation API existe, e identificando a entrada restaurada em `activeRestore` / `isRestoringTraverseNavigation`), além da sincronização do nome de `panels` no polling de 15s e da unificação sequenciada de `refreshDevices`/`syncDeviceAccess`/`syncLegacyFallback`.
- `apps/web/src/lib/online-editor/publication.ts`, `action-bar.tsx`, `publish-dialog.tsx`, `device-manager.tsx`, `editor.css`: estados explícitos para publicação legada ativa/verificação/erro quando `activePanelId === null`; `formatUniqueDisplayName` (`formatDeviceDisplayName` e `formatPanelDisplayName`) livre de colisões com nomes literais pré-cadastrados para dispositivos e painéis homônimos (substituindo também entrada desatualizada em `allEntities` pela entidade `entity` do mesmo `id`, inclusive em `splitDevicePanelAvailability`); `PublishDialog` exibe `ID do painel` e `ID do dispositivo` em campos separados e `DeviceManager` exibe `ID do dispositivo` separado tanto no cartão quanto no `<dialog>` de desvinculação; quebra de palavra em `.online-status-pill` (`390×844` sem overflow com nome de 80 caracteres sem espaços).
- `tests/online-editor-publication.test.ts`, `tests/multiple-panels.test.ts` e `docs/ui-ux/registros/fase-03-execucao.md`: testes unitários cobrindo fallback legado, vínculo sem versão, colisão de rótulos literais e painéis homônimos/renomeados (**16 testes**), testes de integração cobrindo bloqueio 409 de exclusão de fallback legado, publicação cruzada + `/api/player/tasks`, leitura consistente em `/api/player/config` descartando `pageDirective` obsoleto e rascunho legado nunca publicado (**10 testes**), e validação em Chromium com sessão autenticada cobrindo Back/Forward com e sem `window.navigation` (inclusive recriando Forward após Back), **Sair da conta** (confirmação, bloqueio e proteção de Back/Forward em voo), painéis homônimos, campos de ID separados e responsividade (**22 verificações / 97 requests**).

## Comandos automatizados e navegador verificados pelo executor

- `npm run check`: código 0 (`eslint .`, `tsc --noEmit` raiz e `@smartframe/web`, Vitest **28 arquivos / 248 testes**, player **92 testes**).
- Validação em Chromium headless (`127.0.0.1:43205`, fixture isolada em Temp com login real): 22 verificações aprovadas (`errors: []`, `networkRequestsCount: 97`, `1440×1000` `scrollWidth=1425`, `390×844` `scrollWidth=390` inclusive com painel ativo de 80 caracteres sem espaços), registradas em [phase03-browser-report.json](evidencias/fase-03/phase03-browser-report.json).

## Limitações e pendências externas

- Teste físico em aparelho tablet Android/APK **não executado** (requer aparelho de teste e autorização explícita).
- Validação com leitor de tela e teclado físico em navegador interativo não executada.

---

## Gate 1 (revisão externa) e decisão do proprietário (2026-11-23)

- **Revisor externo:** Codex CLI `gpt-6.2-sol`.
- **Rodadas nesta tentativa:** **3**.
- **Resultado final do Gate 1:** `CHANGES_REQUESTED`, com **1 achado `[Medium]` residual** em `apps/web/src/components/online-editor/history-guard.tsx:399`.
- **Decisão do proprietário:** **"Aceitar como está e rodar Gate 2"**. A Fase 03 fica **aceita para entrega no escopo web**, com a limitação residual abaixo registrada e a validação física ainda pendente. O Gate 2 (documentação e changelog) foi executado após essa decisão.

### Limitação conhecida aceita

Em navegadores **sem `window.navigation`**, se o navegador disparar `popstate` antes de `hashchange` ao abrir um novo fragmento logo após Voltar (descartando uma entrada Forward anterior e mantendo `history.length` constante, ex.: `/` → `/layouts` → `#old` → Voltar → `#preview`), o fallback não consegue provar a criação da nova entrada e pode restaurar via `pushState` eliminando a entrada intermediária `/layouts` ao cancelar um salto posterior.

O ponto corresponde à decisão de carimbar passo apenas com evidência de criação da entrada (`hashWasNavPush || lengthGrew`) em `history-guard.tsx:399`; sem Navigation API e sem aumento de `history.length`, a criação não é comprovável.

### Pendências externas mantidas

- Teste físico em aparelho **tablet Android/APK** (requer aparelho e autorização explícita).
- Validação com **leitor de tela e teclado físico** em navegador interativo.

### Escopo do Gate 2

- Alterados apenas `CHANGELOG.md`, `docs/ui-ux/README.md`, `docs/ui-ux/03-publicacao-e-dispositivos.md`, `docs/ui-ux/registros/fase-03-execucao.md` e este registro.
- Nenhuma alteração em código-fonte (`apps/`, `packages/`), testes, schema Prisma, migrations, workflows ou `.env`.
- Nenhum comando de validação foi reexecutado no Gate 2; os resultados automatizados e de navegador registrados acima permanecem os do escopo verificado.
