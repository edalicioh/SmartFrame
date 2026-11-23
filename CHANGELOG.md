# Changelog

Todas as mudanças relevantes deste projeto são registradas neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
As seções descrevem apenas o que foi implementado e verificado; validações
pendentes aparecem explicitamente em **Limitações conhecidas**.

## [Unreleased]

### Added

- Barra de ações do editor (`EditorActionBar`, em
  `apps/web/src/components/online-editor/action-bar.tsx`) com **Salvar rascunho**
  e **Publicar…** sempre visíveis, estado do rascunho separado do estado de
  publicação no dispositivo e banner de conflito 409 com recarga segura.
- Diálogo explícito de publicação (`PublishDialog`, em
  `apps/web/src/components/online-editor/publish-dialog.tsx`) com escolha entre
  **Disponibilizar no tablet** (`activate: false`) e **Exibir no tablet**
  (`activate: true`), nome do painel, campos separados `ID do painel` e
  `ID do dispositivo`, alvo e revisão capturados na abertura, Escape e devolução
  determinística de foco.
- Área de dispositivos e pareamento (`DeviceManager`, em
  `apps/web/src/components/online-editor/device-manager.tsx`), separando o painel
  enviado para exibição dos painéis disponíveis no tablet, com campo
  `ID do dispositivo` separado, bloco agrupado de pareamento (código, servidor,
  instruções, expiração e regeneração) e confirmação de desvinculação nomeando o
  dispositivo.
- `UnsavedDraftProvider` (`apps/web/src/components/online-editor/unsaved-draft-context.tsx`)
  como fonte de verdade do rascunho não salvo no editor.
- `<HistoryGuard />` global em `apps/web/src/app/layout.tsx`, com rastreamento de
  posições de histórico por pares `(__sfStep, __sfEpoch)`.
- Helpers puros de estado de publicação em
  `apps/web/src/lib/online-editor/publication.ts`.
- Suítes de testes `tests/online-editor-publication.test.ts` (16 testes) e
  `tests/multiple-panels.test.ts` (10 testes).

### Changed

- Guarda de rascunho não salvo ampliada para cobrir links `<a href>`, travessias
  Back/Forward e **Sair da conta**:
  - travessias usam `window.navigation` quando disponível e `<HistoryGuard />`,
    preservando o histórico Forward e os metadados `__NA` /
    `__PRIVATE_NEXTJS_INTERNALS_TREE`, e ignorando mudanças puras de fragmento no
    mesmo documento via `stripUrlFragment`;
  - **Sair da conta** (`SignOut`) mantém a trava `signingOut` durante o logout em
    voo e só permite o redirecionamento autorizado para `/login` após sucesso.
- Desambiguação livre de colisões para dispositivos e painéis homônimos, aplicada
  também à sincronização de nomes no polling de 15s.
- Responsividade do editor, da barra de ações, da área de dispositivos e dos
  diálogos até 390 px de largura.

### Fixed

- `activeOnlineVersionWithDevice` em `apps/web/src/lib/active-online-version.ts` e
  `/api/player/config` passam a ler `Device` e `LayoutVersion` na mesma
  `$transaction`, descartando `pageDirective` obsoleto após publicação
  concorrente.
- `DELETE /api/panels` bloqueia com 409 painéis legados `online:<deviceId>` ativos
  por fallback (`activePanelId === null`), alinhado à regra de
  `activeOnlineVersion`.
- `apps/web/src/lib/publish-online-panel.ts` preserva `publishedVersionId` legado
  ao disponibilizar (`activate: false`) painel `online:<deviceId>` para dispositivo
  não ativado ou para outro dispositivo, e `/api/player/tasks` lê a `LayoutVersion`
  mais recente de painéis `online:*`.
- Confirmação de versão exige correspondência estrita entre `activePanelId` e
  `appliedRevision`, com estado dedicado para o fallback legado, evitando associar
  a confirmação de um painel ativo ao rascunho aberto de outro painel.

### Limitações conhecidas

- Em navegadores **sem `window.navigation`**, se o navegador disparar `popstate`
  antes de `hashchange` ao abrir um novo fragmento logo após Voltar (descartando
  uma entrada Forward anterior e mantendo `history.length` constante, por exemplo
  `/` → `/layouts` → `#old` → Voltar → `#preview`), o fallback não consegue provar
  a criação da nova entrada e pode restaurar via `pushState` eliminando a entrada
  intermediária `/layouts` ao cancelar um salto posterior. Limitação registrada no
  Gate 1 (achado `[Medium]` residual em
  `apps/web/src/components/online-editor/history-guard.tsx:399`) e **aceita pelo
  proprietário** para a entrega do escopo web.
- Validação física em aparelho tablet Android/APK **não executada** (pendente de
  aparelho de teste e autorização explícita).
- Validação com leitor de tela e teclado físico em navegador interativo **não
  executada** (os fluxos foram verificados via eventos CDP e foco DOM em Chromium
  headless).
