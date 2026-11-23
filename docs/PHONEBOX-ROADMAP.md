# Roadmap de Evolução inspirado no PhoneBox

Este documento organiza as 6 fases de evolução para incorporar ao SmartFrame os recursos descritos na documentação do [ersinkoc/phonebox](https://github.com/ersinkoc/phonebox/tree/main/docs), mantendo o modelo local-first, validação estrita de contratos com Zod e isolamento de credenciais.

## Visão geral das fases

| Fase       | Frente                                                                     | Status           | Base atual no repositório                                                                                                                                                   |
| :--------- | :------------------------------------------------------------------------- | :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fase 1** | Sistema de Aparência em Camadas (`APPEARANCE.md`)                          | **Implementada** | [widget-style.ts](../packages/contracts/src/widget-style.ts), [APPEARANCE.md](APPEARANCE.md), `smartframe-player`, `/layouts`                                               |
| **Fase 2** | Editor Visual em Grade Livre + Templates                                   | **Implementada** | [online-dashboard.ts](../packages/contracts/src/online-dashboard.ts), [widget-grid.ts](../packages/contracts/src/widget-grid.ts), `smartframe-player`, `/layouts`           |
| **Fase 3** | Múltiplas Páginas e _Smart Stack_                                          | **Implementada** | [online-dashboard.ts](../packages/contracts/src/online-dashboard.ts), [widget-grid.ts](../packages/contracts/src/widget-grid.ts), `smartframe-player`, `/layouts`           |
| **Fase 4** | Novos Widgets (Sistema, Tarefas interativas, Relógio Mundial, RSS, Dev/IA) | **Implementada** | [widgets/src/index.ts](../packages/widgets/src/index.ts), `/api/player/tasks`, `smartframe-player`, `/layouts`                                                              |
| **Fase 5** | Webhooks de Entrada e Regras Automáticas                                   | **Implementada** | `/api/push/[key]`, `/api/notify`, `/api/goto/[page]`, `/api/refresh`, `packages/contracts/src/rules.ts`, `packages/frames/src/webhooks.ts`, `smartframe-player`, `/layouts` |
| **Fase 6** | Modo Control Deck (`CONTROL-DECK.md`)                                      | **Implementada** | [control-deck.ts](../packages/contracts/src/control-deck.ts), `apps/control-deck-agent`, `/api/control-deck/*`, `/api/player/control-deck/execute`, `smartframe-player`, `ControlDeckClient.kt`, `/layouts` |

---

## Fase 1 — Sistema de Aparência em Camadas (Implementada)

- Presets de superfície (`default`, `cards`, `flat`, `borderless`, `seamless`).
- Controles de raio dos cantos (`0–32 px`), espaçamento entre widgets (`0–24 px`), espaçamento interno (`0–24 px`), margem da borda do painel (`0–32 px`), borda e sombra (`Herdar` / `Ativada` / `Desativada`).
- Herança em camadas (**Global/Painel → Widget**) com distinção entre `null`/omitido (herdado) e `0`/`false` (escolha explícita), além de restauração individual para o estilo original (`default`).
- Documentação completa em [APPEARANCE.md](APPEARANCE.md).

---

## Fase 2 — Editor Visual em Grade Livre e Templates (Implementada)

- Campo opcional `gridLayout` no contrato online (`onlineDashboardSchema` em [online-dashboard.ts](../packages/contracts/src/online-dashboard.ts)) com grades **24×24 (paisagem)** e **12×40 (retrato)**, limites validados, tamanhos mínimos do catálogo (incluindo `pomodoro`) e verificação de ausência de colisões entre widgets ativos quando `gridLayout.enabled` está ativo.
- Renderização direta por CSS Grid no `smartframe-player` (`layout.css`, `config.js` e `app.js`), mantendo compatibilidade retroativa total com o modo dividido clássico (`gridLayout` ausente ou `enabled: false`).
- Editor visual em `/layouts` (`apps/web/src/components/online-frame-editor.tsx`) com _drag-and-drop_, redimensionamento pelo canto inferior direito, inspetor numérico acessível (`X`, `Y`, `W`, `H`) e botão **Organizar automaticamente sem colisões** (`autoArrangeDashboardGrid`).
- Galeria com 6 _templates_ prontos (`panelTemplates` e `applyPanelTemplate` em [widget-grid.ts](../packages/contracts/src/widget-grid.ts)) preservando `photoIds`, calendário, recados, tarefas e demais dados do usuário. (A evolução futura do formato `schemaVersion: 2` permitirá múltiplas instâncias do mesmo widget na mesma página.)

---

## Fase 3 — Múltiplas Páginas e _Smart Stack_ (Implementada)

- Campo opcional `pages` (`1..8` páginas com `id`, `title`, `enabledWidgets`, `layoutOptions`, `gridLayout` e `smartStack` por página) e `pageSettings` (`autoRotateSeconds`, `showIndicators`, `swipeEnabled`) no contrato `onlineDashboardSchema`, mantendo compatibilidade retroativa total com painéis de página única.
- Navegação no `smartframe-player` (`index.html`, `config.js`, `app.js`, `layout.css`, `widgets.css`) com indicadores de página (`#page-nav`), visão geral de páginas (`#page-overview`), gesto de deslize horizontal (_swipe_), sincronização da página ativa no preview (`activePageId`) e rotação automática com pausa temporária durante interação.
- **Smart Stack**: campo opcional `smartStack` (até 12 widgets no mesmo slot da grade com rotação manual ou automática `>= 5s` que pausa durante interação ativa), controles verticais (`#smart-stack-nav` e gesto vertical no card), empilhamento automático compartilhado em `autoArrangeDashboardGrid` e configurador completo no editor `/layouts`.

---

## Fase 4 — Novos Widgets (Implementada)

- **Monitoramento do servidor/PC (`system`)**: CPU, RAM, disco e tempo de atividade coletados localmente em [widgets/src/index.ts](../packages/widgets/src/index.ts), sem expor nomes de host, caminhos ou variáveis sensíveis.
- **Tarefas interativas no tablet (`tasks.interactive`)**: botões acessíveis no `smartframe-player` com sincronização autenticada via `POST /api/player/tasks` (atualizando versão ativa e rascunho em transação, com _rollback_ automático em caso de falha).
- **Relógio Mundial (`worldClock`) e Feeds RSS (`rss`)**: até 6 fusos horários internacionais formatados localmente e leitor RSS 2.0/Atom com bloqueio SSRF (`isSafePublicHttpsUrl`), limite de resposta e sanitização em texto puro no servidor.
- **Monitoramento Dev/IA (`devMonitor`)**: telemetria resumida do servidor combinada a cartões de status configuráveis (`ci`, `ai`, `service`, `deploy`).

---

## Fase 5 — Webhooks de Entrada e Regras Automáticas (Implementada)

- Autenticação dedicada por chaves de webhook (`WebhookKey` com hash SHA-256 e prefixo `sf_wh_...`, permissões granulares `push`, `notify`, `goto`, `refresh` e limitação de taxa em `RequestLimit`), isolada das sessões administrativas e das credenciais Bearer dos tablets:
  - `POST /api/push/<key>` recebe estados/métricas externas em `WidgetSnapshot`, reflete no widget `devMonitor` e avalia regras `push_event`.
  - `POST /api/notify` envia notificações temporárias (_toasts_ e alertas visuais) entregues no polling do tablet com renderização via `textContent`.
  - `POST /api/goto/<page>` e `POST /api/refresh` alternam páginas remotamente (por ID, índice, `next` ou `prev`) com duração opcional e atualização sob demanda de widgets.
- Motor de regras declarativas (`packages/contracts/src/rules.ts`) integrado ao contrato `onlineDashboardSchema` e à aba **Automações** em `/layouts`, suportando gatilhos `push_event`, `notify_event` e `time_range` com ações `goto_page` e `show_notification`.

---

## Fase 6 — Modo Control Deck (Implementada)

Inspirado no `CONTROL-DECK.md` do PhoneBox, mantendo a fronteira estrita de segurança do SmartFrame (documentação completa em [CONTROL-DECK.md](CONTROL-DECK.md)):

- **Identificação por ID opaco**: o tablet exibe e envia apenas o ID do vínculo (`bindingId`); caminhos físicos de executáveis, argumentos, scripts e credenciais nunca são enviados ao dispositivo nem transitam pelo navegador do player.
- **Agente local dedicado (`apps/control-deck-agent`)**: serviço Node/TS em loopback (`127.0.0.1` / `::1`) autenticado por Bearer token (`>= 32` caracteres) com drivers Windows e Linux sem interpolação de shell, allowlist local de atalhos (`SMARTFRAME_CONTROL_DECK_SHORTCUTS_FILE`) e _lease_ automático de segurança para Push-to-Talk (`2..30`s).
- **Ações no host**: botões estilo _Control Deck_ para atalhos locais, controle de mídia, volume de saída/aplicativos, microfone / _Push-to-Talk_ e controle de brilho, integrados à aba **Control Deck** em `/layouts`, ao `smartframe-player` e à bridge nativa Android `SmartFrameControlDeck` ([ControlDeckClient.kt](../apps/android/app/src/main/java/com/smartframe/player/ControlDeckClient.kt)).
- **Sem valores fictícios e sem reenvios cegos**: dispositivos ou integrações ausentes exibem estado indisponível (`level: null`, `muted: null`); comandos não idempotentes com perda de resposta reportam resultado desconhecido (`status: "unknown"`, HTTP `504`) sem repetir cegamente.

---

## O que ainda falta

### 1. Fechamento operacional das Fases 5 e 6 (implementadas no código)

- **Code review, build e smoke HTTP da Fase 5**: concluídos (revisões Web, Player e Segurança aplicadas; `npm run check`, `npm run build`, `npm run test:smoke` e `npm run test:smoke:local` verdes).
- **Migrations em banco real**: as migrations [20261120120000_webhooks_and_rules](../packages/database/prisma/migrations/20261120120000_webhooks_and_rules/migration.sql) e [20261120180000_control_deck_bindings](../packages/database/prisma/migrations/20261120180000_control_deck_bindings/migration.sql) foram validadas no banco isolado do Vitest; antes de subir o ambiente real, fazer backup consistente e rodar `npm run db:migrate`.
- **Validação do agente local em host Windows/Linux real**: subir `npm run control-deck:agent` com `SMARTFRAME_CONTROL_DECK_TOKEN` e `SMARTFRAME_CONTROL_DECK_URL` configurados no host alvo e validar controles de mídia, Core Audio/pactl, brilho e atalhos reais.
- **Validação em aparelho físico Android (APK atualizado)**: compilar/instalar build compatível com a bridge `SmartFrameControlDeck` e testar exibição/fechamento de _toasts_, `/api/goto/<page>`, atualização de `devMonitor` via `/api/push/<key>`, disparo de regras `time_range` e execução/PTT no Control Deck no tablet pareado.

### 2. Evoluções futuras (pós-roadmap)

- **Múltiplas instâncias do mesmo widget na mesma página**: evolução futura para `schemaVersion: 2` (referenciada na Fase 2).
- **Bridge nativa opcional no APK para dispensa persistida de notificações**: hoje `POST /api/player/notifications/dismiss` existe na API e o player já deduplica e dispensa _toasts_ em memória no navegador (`smartframe-player/js/app.js`) para manter compatibilidade total com o `OnlinePlayer.kt` atual sem exigir recompilação imediata do APK.
