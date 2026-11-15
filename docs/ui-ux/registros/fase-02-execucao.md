# Fase 02 — execução

Responsável: Luna-6
Rodada inicial: 2026-11-06; retomada e conclusão técnica: 2026-11-07
Referência: alterações locais sem commit; snapshot fase01 preservado.
Escopo: fase02 somente. Não houve alteração de contrato, API, autenticação, persistência, player ou APK.

## Rodada inicial — 2026-11-06 (histórico)

**Execução parcial.** A rodada inicial registrou somente inspeção e telas vazias, sem alegar aceites de browser. Seu histórico e evidências permanecem preservados no sandbox e nas imagens `layouts-vazio-*`.

## Retomada — 2026-11-07

O trabalho foi retomado em sandbox temporário datado de 2026-11-07, clonado do
SQLite/storage fixture isolado da fase02. O registro de revisão do Sol de 2026-11-06
foi preservado sem alterações. Não foi refeita fase01 nem iniciada fase03.

**Resultado técnico: correções F02-R01–R08 implementadas; os oito critérios de aceite
anteriores e as reproduções de ciclo de vida abaixo passaram em Chromium real.**
F02-R07/R08 aguardam confirmação independente do Sol; não é aprovação formal.

### Implementação concluída

- Fallback de miniatura declarativo, acessível e também presente na ordem; 404 tratado.
- Reordenação/foco por ID estável; foco vai à ação habilitada ou ao item ao atingir extremidade.
- Campo numérico mantém draft transitório, erro acessível, não grava `Number("")` nem valor antigo silenciosamente e bloqueia salvar; reset do estado inválido ao trocar painel.
- Campo numérico sem erro deriva o valor exibido da prop canônica atualizada; draft/error inválidos sobrevivem ao toggle via subtree montado sob `hidden`; problemas numéricos são derivados do mapa atual e só removidos ao corrigir o campo, trocar painel ou excluir o item dono.
- Configurações agrupadas por widget; fuso e atualização geral em opções avançadas; erros de validação permanecem em alerta global mesmo com widget desativado/controles ocultos.
- Preview mantém iframe/origem restrita, proporcional 10:16 e 16:10, responsivo sem overflow horizontal; alternância móvel mantém a mesma instância.
- Helpers puros de foto usados no código/testes; helper de append não utilizado removido.
- Seletor Preencher/Conter agora tem ajuda associada explicando corte, imagem inteira e possíveis áreas de fundo.

### Aceites comprovados no browser

| # | Critério | Prova da retomada |
|---|---|---|
| 1 | Biblioteca e estados | Chromium 156: ready/pending/processing/error/unknown, miniatura autenticada 404 com fallback acessível, nomes longos/duplicados. |
| 2 | Selecionar, ordenar e limite | Seleção por UI até 100 IDs únicos; tentativa 101 explicada; reordenação por teclado/foco/ID nos extremos e anúncio visível. |
| 3 | Retirada isolada | Retirada de A preserva a mesma mídia na biblioteca e no painel B. |
| 4 | Widgets e configuração | 11 toggles/grupos desativados/restaurados; todos os 10 widgets desligados foram salvos/recarregados, reativados e salvos/recarregados novamente, preservando configurações. Recado vazio e aniversário impossível continuam bloqueados com widgets desativados; moedas respeitam mínimo 1. |
| 5 | Aparência | Tema escuro, paleta customizada, fundos/tamanhos de cartões, fuso e refresh persistiram após reload. |
| 6 | Preview do draft | Captura real de `postMessage` com origem estrita, conteúdo alterado não salvo, sem token/device ID; orientação paisagem/retrato refletida pela mesma iframe. Bounds 10:16 / 16:10 em 1440×1000 e 390×844, sem overflow horizontal. |
| 7 | Upload parcial | Upload real via CDP com PNG aceito + TXT inválido; sucesso preservado, erro identifica arquivo, sem seleção automática nem reenvio. |
| 8 | Não publicar/alterar contratos | Auditoria de rede sem publish, pairing ou mutação de dispositivo; sem token/ID de dispositivo em URL; alterações limitadas a editor/CSS/helpers/testes/docs. |

### Validações adicionais

- Campo numérico vazio e fora da faixa exibe erro e bloqueia request de save.
- Draft inválido de A, após confirmação de descarte e troca a B, não vaza erro/mapa; B foi alterado e salvo (`PUT` com revisão esperada).
- Invalidar intervalo numérico em Recados, ocultar o widget e tentar salvar manteve alerta global acessível, manteve o bloqueio e enviou zero requests `PUT`. Registro separado: uma verificação passou, sem erros.
- Prova suplementar aprovada em Chromium 156: todos os 10 widgets e o toggle “Mostrar concluídas” foram desligados, salvos e recarregados; valores customizados continuaram intactos. Os 10 widgets foram reativados, “Mostrar concluídas” restaurado, salvos e recarregados novamente; configurações preservadas. Relatório tem 2 checks, `errors=[]`, 2 saves. Falhas prévias do harness (serialização DOM e contagem de controles dinâmicos) foram corrigidas antes da execução aprovada.

## Comandos e resultados

- Ambiente: Windows; Node v24.19.0; npm 11.17.0; Next 16.4.3; Chromium 156.0.8078.4.
- `npm run check`: código 0 — ESLint, typecheck raiz/web, Vitest **18 arquivos/110 testes** e testes do player **34 aprovados**. Uma execução inicial revelou erro de lint no efeito do campo numérico; corrigido, check repetido e aprovado.
- `git diff --check`: código 0; somente avisos informativos LF/CRLF nos arquivos modificados.
- `phase02-browser-full.mjs`: 26 verificações, `errors=[]`, 282 requests inspecionadas; sucesso em todos os oito aceites. `phase02-numeric-hide.mjs`: verificação adicional passou, `errors=[]`. `phase02-widget-toggle-persistence.mjs`: 2 checks de salvar/recarregar desligado e restaurado, `errors=[]`, 2 saves.

## Browser, isolamento e evidências

- Retomada em `127.0.0.1:43195`, CDP `127.0.0.1:43196`, Chromium headless com perfil dedicado; processos encerrados pelo próprio roteiro.
- SQLite, storage, perfis, player config e uploads somente em `C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase02-browser-20261107\`. Fixture com dois painéis/dados sintéticos, incluindo 104 fotos prontas e quatro estados adicionais. Login desativado somente no processo local; email/segredo são exclusivos da fixture.
- Roteiros no sandbox Temp: `C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase02-browser-20261107\phase02-browser-full.mjs`, `phase02-numeric-hide.mjs`, `phase02-widget-toggle-persistence.mjs`, `phase02-numeric-lifecycle-fix.mjs` e `seed-phase02.mjs`. Relatórios preservados: [suite completa](evidencias/fase-02/phase02-browser-report-20261107.json), [campo oculto](evidencias/fase-02/phase02-numeric-hide-report-20261107.json), [persistência dos toggles](evidencias/fase-02/phase02-widget-toggle-report-20261107.json) e [ciclo de vida pós-revisão](evidencias/fase-02/phase02-numeric-lifecycle-fix-20261107.json).
- Capturas: [biblioteca/estados](evidencias/fase-02/phase02-20261107-01-library-states-desktop.png), [limite 100](evidencias/fase-02/phase02-20261107-02-limit-100.png), [erro numérico oculto](evidencias/fase-02/phase02-20261107-04-numeric-error-widget-hidden.png), [widgets desligados após reload](evidencias/fase-02/phase02-20261107-07-widgets-all-off-persisted.png), [widgets restaurados após reload](evidencias/fase-02/phase02-20261107-09-widgets-restored-persisted.png), [preview portrait/landscape 1440](evidencias/fase-02/phase02-20261107-preview-portrait-1440.png) / [paisagem](evidencias/fase-02/phase02-20261107-preview-landscape-1440.png), [portrait/landscape 390](evidencias/fase-02/phase02-20261107-preview-portrait-390.png) / [paisagem](evidencias/fase-02/phase02-20261107-preview-landscape-390.png), [modo preview móvel](evidencias/fase-02/phase02-20261107-mobile-preview-mode.png), [editor móvel](evidencias/fase-02/phase02-20261107-08-final-mobile-editor.png). As capturas contêm somente dados fixture.
- Os relatórios não contêm credenciais; os registros de rede guardam método/caminho e flags booleanas, não URLs completas ou cabeçalhos.

## Segunda rodada independente — correções posteriores — 2026-11-07

O registro original `fase-02-revisao.md` e o script/relatório do Sol foram mantidos
intactos. Preservadas as oito evidências anteriores; correções restritas à fase02.
Como a revisão encontrou divergência no lifecycle, a aprovação formal permanece
dependente da reavaliação do Sol.

- F02-R07 — prop canônica/polling: o campo válido exibe `String(value)` da prop
  atual, não apenas o `useState` inicial. PUT fixture externo mudou intervalo de
  fotos 37→38; o polling trouxe r2 e o input mostrou 38 sem erro.
- F02-R07 — exclusão: remoção de aniversário limpa somente as issues `day` e
  `month` daquele ID removido. Após invalidar o dia e excluir a pessoa, painel
  salvou r3 (`PUT` +1), sem alerta residual.
- F02-R07 — toggle/recuperação: controles adicionais permanecem montados sob
  `hidden` ao desativar. Intervalo de Recados inválido `2` manteve valor, erro
  inline, `aria-invalid=true` e alerta global ao ocultar/restaurar; Save bloqueou
  sem PUT. Corrigir para 37 removeu a issue e salvou r4 (`PUT` +1); leitura da
  fixture confirmou 37.
- F02-R08: seletor tem `aria-describedby="photos-fit-help"`; a ajuda descreve
  corte em Preencher, imagem inteira em Conter e áreas de fundo possíveis. Nenhuma
  alteração no player.
- Roteiro independente local `phase02-numeric-lifecycle-fix.mjs`: Chromium
  156.0.8078.4, cinco checks, `errors=[]`; requests sem publicação/pareamento ou
  mutação de painel de dispositivo. Um painel adicional de fixture foi criado por
  API existente; nenhuma fixture foi reseed/apagada.
- `npm run check` repetido após estas correções: código 0 — ESLint, typecheck raiz/web,
  Vitest 18 arquivos/110 testes e testes do player 34/34. `git diff --check` final
  também passa; Git emite somente avisos informativos LF/CRLF.
- Evidências: [relatório](evidencias/fase-02/phase02-numeric-lifecycle-fix-20261107.json),
  [poll canônico](evidencias/fase-02/phase02-20261107-10-r07-poll-canonical-number.png),
  [exclusão e save](evidencias/fase-02/phase02-20261107-11-r07-birthday-delete-save-recovered.png),
  [inválido oculto/restaurado](evidencias/fase-02/phase02-20261107-12-r07-invalid-notes-hidden-restored.png),
  [correção e save](evidencias/fase-02/phase02-20261107-13-r07-numeric-corrected-save.png),
  [ajuda de ajuste](evidencias/fase-02/phase02-20261107-14-r08-fit-help.png).

## Passagem para revisão independente

Revisar os aceites/evidências acima, em especial as recuperações F02-R07 e ajuda F02-R08; manter o registro de Sol intacto. Nenhum commit, deploy, publicação, pareamento, dado real ou teste em tablet. Fase 03 não iniciada.
