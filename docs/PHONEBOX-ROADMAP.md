# Roadmap de Evolução inspirado no PhoneBox

Este documento organiza as 6 fases de evolução para incorporar ao SmartFrame os recursos descritos na documentação do [ersinkoc/phonebox](https://github.com/ersinkoc/phonebox/tree/main/docs), mantendo o modelo local-first, validação estrita de contratos com Zod e isolamento de credenciais.

## Visão geral das fases

| Fase       | Frente                                                                     | Status           | Base atual no repositório                                                                                                                                         |
| :--------- | :------------------------------------------------------------------------- | :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fase 1** | Sistema de Aparência em Camadas (`APPEARANCE.md`)                          | **Implementada** | [widget-style.ts](../packages/contracts/src/widget-style.ts), [APPEARANCE.md](APPEARANCE.md), `smartframe-player`, `/layouts`                                     |
| **Fase 2** | Editor Visual em Grade Livre + Templates                                   | **Implementada** | [online-dashboard.ts](../packages/contracts/src/online-dashboard.ts), [widget-grid.ts](../packages/contracts/src/widget-grid.ts), `smartframe-player`, `/layouts` |
| **Fase 3** | Múltiplas Páginas e _Smart Stack_                                          | **Implementada** | [online-dashboard.ts](../packages/contracts/src/online-dashboard.ts), [widget-grid.ts](../packages/contracts/src/widget-grid.ts), `smartframe-player`, `/layouts` |
| **Fase 4** | Novos Widgets (Sistema, Tarefas interativas, Relógio Mundial, RSS, Dev/IA) | **Implementada** | [widgets/src/index.ts](../packages/widgets/src/index.ts), `/api/player/tasks`, `smartframe-player`, `/layouts`                                                    |
| **Fase 5** | Webhooks de Entrada e Regras Automáticas                                   | Planejada        | Rotas em `apps/web/src/app/api` e fila em `packages/jobs`                                                                                                         |
| **Fase 6** | Modo Control Deck (`CONTROL-DECK.md`)                                      | Planejada        | Autenticação de dispositivo em `packages/frames` e agente local                                                                                                   |

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

## Fase 5 — Webhooks de Entrada e Regras Automáticas (Planejada)

- Endpoints autenticados por chave de webhook dedicada (isolada da credencial Bearer dos tablets):
  - `POST /api/push/<key>` para alimentar widgets de valor/status externo.
  - `POST /api/notify` para notificações temporárias (_toasts_) e alertas visuais no tablet.
  - `POST /api/goto/<page>` e atualização sob demanda.
- Motor de regras declarativas para troca automática de página conforme eventos (ex.: alerta de CI, início de foco, notificação prioritária ou horário).

---

## Fase 6 — Modo Control Deck (Planejada)

Inspirado no `CONTROL-DECK.md` do PhoneBox, mantendo a fronteira estrita de segurança do SmartFrame:

- **Identificação por ID opaco**: o tablet exibe e envia apenas o ID do vínculo (`bindingId`); caminhos físicos de executáveis, argumentos, scripts e credenciais nunca são enviados ao dispositivo nem transitam pelo navegador do player.
- **Ações no host**: botões estilo _Control Deck_ para atalhos locais, controle de mídia, volume de saída/aplicativos, microfone / _Push-to-Talk_ com expiração automática (_lease_ de segurança) e controle de brilho.
- **Sem valores fictícios e sem reenvios cegos**: dispositivos ou integrações ausentes exibem estado indisponível; comandos não idempotentes com perda de resposta reportam resultado desconhecido em vez de repetir cegamente.
