# Roadmap de Evolução inspirado no PhoneBox

Este documento organiza as 6 fases de evolução para incorporar ao SmartFrame os recursos descritos na documentação do [ersinkoc/phonebox](https://github.com/ersinkoc/phonebox/tree/main/docs), mantendo o modelo local-first, validação estrita de contratos com Zod e isolamento de credenciais.

## Visão geral das fases

| Fase       | Frente                                                                     | Status           | Base atual no repositório                                                                                                                                         |
| :--------- | :------------------------------------------------------------------------- | :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fase 1** | Sistema de Aparência em Camadas (`APPEARANCE.md`)                          | **Implementada** | [widget-style.ts](../packages/contracts/src/widget-style.ts), [APPEARANCE.md](APPEARANCE.md), `smartframe-player`, `/layouts`                                     |
| **Fase 2** | Editor Visual em Grade Livre + Templates                                   | **Implementada** | [online-dashboard.ts](../packages/contracts/src/online-dashboard.ts), [widget-grid.ts](../packages/contracts/src/widget-grid.ts), `smartframe-player`, `/layouts` |
| **Fase 3** | Múltiplas Páginas e _Smart Stack_                                          | Planejada        | Fluxo online multi-painel em `apps/web` e `smartframe-player`                                                                                                     |
| **Fase 4** | Novos Widgets (Sistema, Tarefas interativas, Relógio Mundial, RSS, Dev/IA) | Planejada        | Provedores em `packages/widgets` e renderizadores em `smartframe-player`                                                                                          |
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

## Fase 3 — Múltiplas Páginas e _Smart Stack_ (Planejada)

- Permitir múltiplas páginas por painel publicado, mantendo compatibilidade com painéis de página única.
- Navegação no `smartframe-player` por gestos de deslize horizontal (_swipe_), indicadores de página (_dots_), visão geral e troca remota opcional.
- Introduzir o widget **Smart Stack**: empilhamento de até 12 widgets no mesmo slot da grade, com troca vertical ou rotação automática que pausa durante interação ativa.

---

## Fase 4 — Novos Widgets (Planejada)

- **Monitoramento do servidor/PC**: CPU, RAM, disco, rede e status de contêineres/processos locais coletados com validação no backend/worker, sem expor dados sensíveis.
- **Tarefas interativas no tablet**: permitir marcar e desmarcar itens diretamente no `smartframe-player` com sincronização autenticada de volta ao rascunho/estado do painel.
- **Relógio Mundial e Feeds RSS**: múltiplos fusos horários configuráveis e leitor RSS sanitizado no servidor (sem acesso externo direto do player HTML).
- **Monitoramento Dev/IA**: visão de sessões ativas, status de builds/PRs e métricas locais de ferramentas de desenvolvimento.

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
