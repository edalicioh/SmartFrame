# Fase 02 — revisão

Responsável: Sol-6.1.
Data: 2026-11-06.
Referência: alterações locais sem commit sobre HEAD
`b30e5125c68f66136086a3391c906c1cb3adf095`; revisão incremental comparada também
ao snapshot da fase 01 aprovada em
`C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase02-baseline-20261106`.
Escopo: somente fase 02; preservar fase 01 e não implementar fase 03.

**Veredito atual: APROVADA**, em 2026-11-07, após a reavaliação final registrada
ao fim deste arquivo. As duas rodadas de ajustes são histórico preservado, não
pendências atuais. Fase 03 permanece não iniciada, aguardando comando do usuário.

## Primeira rodada — execução parcial

**Veredito: AJUSTES NECESSÁRIOS.** A primeira entrega declara-se parcial e não
possui evidências dos cenários obrigatórios com editor preenchido. O revisor leu
plano, protocolo, registro, componentes, helpers, testes, diff incremental,
rota de fotos e instruções locais; executou `npm run check` independentemente.

### Achados

#### F02-R01 — Média — Miniaturas/estado oculto e ordem incompletos

- Localização: `apps/web/src/components/online-editor/photo-library.tsx:28-29`,
  `:36-40`; regras `.online-library-photo > img, .photo-thumb-fallback` em
  `apps/web/src/app/editor.css`.
- Evidência: fallback usa atributo `hidden`, mas o CSS de autor lhe atribui
  `display: grid`, assim como à imagem que o `onError` tenta ocultar por `hidden`.
  A precedência sobre o estilo padrão do navegador pode manter fallback/imagem
  visíveis. Conferência exigida no navegador. A lista ordenada não tem miniatura,
  embora a tarefa 02.2 a exija. O fallback está integralmente `aria-hidden`.
- Impacto: apresentação incorreta e ausência de indicação acessível de falha;
  ordem sem identificação visual conforme o plano.
- Correção esperada: estado de erro renderizado de forma declarativa e respeitado
  pelo CSS, fallback textual acessível e miniatura também na ordem; carregar apenas
  ready, com lazy loading e sem nova API.

#### F02-R02 — Média — Foco após reordenação usa nome, não ID estável

- Localização: `apps/web/src/components/online-frame-editor.tsx`, `movePhoto`,
  e botões de movimento em `online-editor/photo-library.tsx:39`.
- Evidência: procura o botão por `aria-label` contendo filename. Dois arquivos
  distintos podem ter o mesmo nome, levando foco ao item errado. Ao mover até a
  extremidade, a mesma ação fica `disabled` e não pode receber foco.
- Impacto: perde a continuidade por teclado, descumprindo 02.2.
- Correção esperada: referência por ID estável e fallback de foco na ação habilitada
  ou no próprio item; provar movimentos para ambas as extremidades e nomes iguais.

#### F02-R03 — Média — Campo inválido sem erro e alterações indevidas em texto

- Localização: guards `event.target.value !== ""` no editor online e
  `apps/web/src/components/local-widget-editor.tsx`.
- Evidência: simplesmente ignorar vazio não oferece erro legível e reverte a edição.
  Outros campos numéricos mantêm `Number("")`, incluindo dia/mês e intervalos.
  O guard foi aplicado também ao texto de recado e nome de aniversário,
  impedindo apagá-los para editar, sem necessidade relacionada à coerção numérica.
- Impacto: requisito 02.4 incompleto, formulário com tratamento inconsistente e
  regressão em campos de texto.
- Correção esperada: entrada numérica com valor textual transitório e validação
  explícita, sem salvar vazio como zero nem salvar silenciosamente valor antigo;
  manter erros alcançáveis e identificar campo. Remover guards indevidos de texto.

#### F02-R04 — Média — Configuração progressiva/avançada incompleta

- Localização: seção Widgets e final de Aparência em `online-frame-editor.tsx`.
- Evidência: todos os controles comuns estão em um único details separado dos
  widgets, sem progressividade por grupo. Fuso e atualização continuam fora de
  opções avançadas. A implementação não foi completada conforme 02.3/02.4.
- Impacto: organização prevista não entregue integralmente.
- Correção esperada: grupos concretos com ativação, descrição e opções relevantes;
  preservar valores no toggle; agrupar avançados sem esconder erros de validação.

#### F02-R05 — Média — Proporção de prévia retrato não comprovada

- Localização: `.draft-preview.portrait` em `editor.css` e iframe do editor online.
- Evidência: `width: 100%` herdado e `max-height` independente podem limitar a altura
  sem reduzir proporcionalmente a largura. Só foram capturadas telas sem painel.
- Impacto: risco de contêiner distorcido, contrário à tarefa 02.5; falta evidência
  de orientação no editor preenchido.
- Correção esperada: limitar largura/altura proporcionalmente e medir a razão
  dos bounding rects reais em ambas as orientações/viewports, sem transformar o player.

#### F02-R06 — Média — Cenários obrigatórios de navegador pendentes

- Localização: `fase-02-execucao.md`, tabela de aceites e pendências.
- Evidência: editor não foi aberto com painel, nem simulados ready/pending/erro,
  upload parcial, limite, reordenação, toggles, persistência customizada ou rede.
- Impacto: critérios 1–7 ainda não comprovados. O script fornecido só navega e
  registra telas sem selecionar painel; não é impedimento de ambiente.
- Correção esperada: completar fixtures isoladas e todos os cenários do plano,
  com assertions reais, screenshots sem credenciais e rede sem publish implícito.
  Incluir retirada em A preservando B/biblioteca, todos os widgets e erro numérico.

### Comandos independentes — primeira rodada

- `npm run check`: sucesso (lint, typecheck, **18 arquivos / 110 testes Vitest**,
  **34 testes player**), Windows, Node 24.19.0 / npm 11.17.0.
- `git diff --no-index -- <snapshot-fase01> <arquivo-atual>`: executado para
  editor/CSS; código 1 esperado porque existem diferenças, não falha de validação.
- `git status --short`: fase 01 preservada; novas alterações do editor de widgets,
  componentes/helpers de fotos, teste e documentação identificadas.
- Sem testes DOM/E2E novos por dependência, build, deploy, commit, acesso a dados
  reais ou implementação da fase 03.

### Critérios e encaminhamento

O critério 8 (sem alteração de API/contrato/player) está atendido no diff.
Critérios 1–7 não podem receber aceite nesta rodada. F02-R01–R06 têm severidade
média e bloqueiam aprovação. Luna-6 deve corrigir/completar a **fase 02** e
registrar evidências para nova revisão independente. Não iniciar fase 03.

## Retomada da revisão — 2026-11-07

Após reinicializações do servidor, o trabalho local e o snapshot da fase 01 foram
preservados. A execução Luna-6 foi retomada sobre os arquivos existentes, sem
recomeçar a fase 01. Os achados acima continuam abertos até reavaliação das
correções/evidências; retomada não equivale a aprovação.

Conferência independente de contratos e fronteiras de segurança, sem alterar
arquivos de implementação enquanto o executor conclui as correções:

- `packages/contracts/src/online-dashboard.ts`: máximo de 100 IDs únicos,
  intervalos de fotos/recados 5–3600 s e atualização geral 10–3600 s. Configuração
  de widget desativado continua sujeita ao schema; não se pode apagar seus dados
  para contornar validação. Aniversários validam também a combinação dia/mês.
- `packages/contracts/src/currencies.ts`: 1–20 pares únicos, origem diferente do
  destino, códigos reconhecidos, quantidade exibida 1–4 e intervalo 5–3600 s.
- `api/photos/[id]/image/route.ts`: autenticação administrativa, filtro por família
  e `status=ready`, resposta privada/no-store. Miniaturas devem usar essa rota,
  sem substituir autorização por URL/token de dispositivo.
- `api/photos/route.ts`: upload multipart aceita JPEG/PNG/WebP; processamento e
  seleção no painel são etapas distintas. A revisão preserva a API existente.
- `api/panels/route.ts`: gravação permanece condicionada a `expectedRevision`,
  propriedade familiar e origem autorizada. Retirar seleção de um painel não
  equivale a excluir mídia nem a alterar outro painel.
- `smartframe-player/js/app.js:273-297`: prévia aceita mensagens somente do pai
  de mesma origem e retorna antes do polling de produção. Dados dos widgets vêm
  de `api/online-frame/widgets` com sessão/origem administrativa e cache privado.
  Essa fronteira não exige nem permite encaminhar credencial de dispositivo.

Essas são referências de inspeção para a reavaliação, não evidência de interação
com a nova UI. Testes e evidências finais serão registrados após a conclusão do
executor, sem atribuir sucesso a cenários ainda pendentes.

## Segunda rodada — revisão independente de 2026-11-07

Luna-6 completou os roteiros e forneceu 26 verificações, prova suplementar de
toggles salvos/recarregados e erro numérico com widget oculto. O revisor conferiu
diff incremental, código novo e relatórios, além de executar `npm run check`:
**sucesso**, 18 arquivos/110 testes Vitest e 34 testes do player.

F02-R01, R02, R04 e R05 receberam correções compatíveis por inspeção:
miniaturas/fallback declarativos, foco por ID estável, grupos e opções avançadas,
proporção derivada da largura. As evidências do executor são úteis, mas não
encerram F02-R03/F02-R06 diante das regressões reproduzidas abaixo.

### F02-R07 — Média — Ciclo de vida do estado numérico inconsistente

- Localização: `online-editor/validated-number-field.tsx:9-17`,
  `online-frame-editor.tsx:360-375`, `:472-475` e remoção de aniversário em
  `local-widget-editor.tsx`.
- **Reprodução independente, navegador real:**
  1. Painel B de fixture carregado com intervalo 19 e r3. PUT de teste isolado
     alterou o intervalo para 37/r4 com `expectedRevision`. O polling da UI
     reconheceu **r4 salvo**, mas o input continuou em **19**. O componente usa
     `value` somente para inicializar estado local e não acompanha prop atualizada.
  2. Esvaziado o dia de um aniversário, depois removido esse aniversário e acionado
     Salvar. O campo já não existia, porém o mapa `numericIssues` reteve seu ID:
     alerta **“Corrija os campos numéricos: birthdays day fixture-birthday.”** e
     **zero PUT**. O usuário não consegue corrigir o item excluído para salvar.
  3. Intervalo de Recados editado para 2: valor inválido/`aria-invalid=true`.
     Desativado/reativado o widget, o campo remontou em **31**,
     `aria-invalid=false`, sem erro local; o alerta global ainda reclamou de 2.
     O rascunho transitório e o registro global se contradizem.
- **Impacto:** formulário mostra dados diferentes do rascunho atualizado e pode
  bloquear salvamento por campo removido, ou exigir correção de um valor que já
  não aparece. Viola fonte de verdade, preservação de configuração e tratamento
  coerente de entradas inválidas. F02-R03 permanece aberto por essas regressões.
- **Correção esperada:** sincronizar valores válidos com props/polling;
  preservar estado transitório/erro ao desativar e reativar, sem apagar nem salvar
  silenciosamente o valor anterior; remover validação apenas de itens realmente
  excluídos; resetar corretamente por painel. Testar a recuperação e o salvamento,
  não só o bloqueio inicial. Não limpar indiscriminadamente erros ao ocultar campo.

### F02-R08 — Média — Explicação de Preencher/Conter ainda ausente

- Localização: `online-frame-editor.tsx:831-832` e checklist 02.2.
- Evidência: opções continuam apenas “Preencher”/“Conter”, sem texto que explique
  corte versus imagem inteira. Busca no editor não encontrou explicação de corte.
- Impacto: tarefa explícita de seleção/apresentação de fotos não atendida.
- Correção esperada: ajuda textual associada ao seletor, explicando possível corte
  em Preencher e imagem inteira/áreas de fundo em Conter, sem alterar o player.

### Evidência e comandos desta rodada

- Script independente `sol-phase02-review.mjs`, no sandbox temporário de
  2026-11-07 indicado na execução; comando `node <sandbox>/sol-phase02-review.mjs`.
  Next somente `127.0.0.1:43197`, CDP `127.0.0.1:43198`, Chromium 156, perfil
  separado `sol-profile`, mesmos SQLite/storage **exclusivamente fixture**.
- O roteiro caracteriza as falhas acima (não as confunde com aprovações): terminou
  código 0, sem erro de transporte, com três inconsistências registradas e sem
  chamada de publicação/pareamento. Alteração de intervalo somente no painel B
  sintético, nunca em dados reais. Processos próprios encerrados por PID.
- [Relatório bruto](evidencias/fase-02/sol-numeric-lifecycle-inicial-20261107.json)
  e [campo removido ainda bloqueia salvar](evidencias/fase-02/sol-numeric-item-removed-save-20261107.png).

**Veredito mantido: AJUSTES NECESSÁRIOS.** Resolver F02-R03/R07/R08 e repetir
validações/cenários de recuperação. F02-R06 só será encerrado na reavaliação
final. Fase 03 continua não iniciada.

## Reavaliação final — 2026-11-07

Responsável: Sol-6.1. Conferidos os arquivos finais, diff incremental sobre a fase
01 aprovada, correções posteriores, relatórios brutos e screenshots. A revisão
não se limitou a aceitar a conclusão do executor: o primeiro roteiro independente
reproduziu F02-R07 e o roteiro final passou a exigir a recuperação dos mesmos fluxos.

### Achados encerrados

| Achado | Conferência final e evidência | Situação |
| --- | --- | --- |
| F02-R01 | Miniatura e erro renderizados declarativamente; fallback nomeado via `role=img`/`aria-label`; miniatura na ordem. Next Image usa `unoptimized` e rota administrativa existente, com lazy loading padrão; itens não ready não têm imagem nem seleção habilitada. Fallback 404 reproduzido pelo revisor. | Encerrado. |
| F02-R02 | Refs de itens/ações indexadas por ID; ação habilitada recebe foco, ou o próprio item ao atingir extremidade. Revisor moveu por Space uma das fotos com nome duplicado até a primeira posição e confirmou foco no ID correto. | Encerrado. |
| F02-R03 | Draft textual inválido e erro local mantidos, valores canônicos válidos exibidos diretamente da prop; erros registrados no proprietário impedem save. Texto de recados/nomes pode ser apagado para editar; schema ainda rejeita vazio em save. | Encerrado, incluindo as regressões de R07. |
| F02-R04 | Opções de Relógio, Clima, Moedas e Calendário agrupadas; widgets adicionais com descrição/ativação e controles preservados sob `hidden`. Fuso/refresh em opções avançadas. Alerta de validação global permanece fora dos grupos fechados/ocultos. | Encerrado. |
| F02-R05 | Largura de retrato deriva do limite de altura com razão 0,625; iframe sem transform. Bounds reais medidos pelo revisor em retrato/paisagem e dois viewports, com mesma instância de iframe. | Encerrado. |
| F02-R06 | Roteiro do executor com 26 verificações e provas adicionais, mais 15 verificações independentes finais; todos os oito aceites abaixo possuem evidência. | Encerrado. |
| F02-R07 | Poll 37→38 refletido no input; excluir aniversário inválido removeu apenas os erros daquele ID e permitiu PUT; toggle de Recados manteve `2`, erro inline/global e bloqueio; corrigir para 36 permitiu salvar e persistiu 36. | Encerrado por reprodução independente. |
| F02-R08 | `aria-describedby=photos-fit-help` associa texto sobre corte em Preencher e imagem inteira/áreas de fundo em Conter. Texto e associação conferidos no DOM e screenshot pelo revisor. | Encerrado. |

O achado cosmético R06 da fase 01 também foi tratado pelo executor com decoração
vazia removida por `:empty`, sem desmontar a região de status. A revisão da fase
01 não foi reescrita nem sua implementação descartada.

### Critérios de aceite — resultado final

| # | Evidência avaliada | Resultado |
| --- | --- | --- |
| 1 | Ready com miniaturas, estados pending/processing/error/desconhecido textuais e desabilitados; erro real de imagem com fallback acessível. Revisor repetiu esses casos com a fixture preenchida. | Atendido. |
| 2 | Helpers reais usados pela UI e testes; executor exercitou retirada/movimentos nos dois extremos. Revisor selecionou 100 IDs únicos e comprovou recusa explicada do 101º; reordenação por teclado com nomes iguais manteve foco no ID. | Atendido. |
| 3 | Executor retirou de A, salvou/recarregou e confirmou mídia/biblioteca e seleção de B intactas. Código só altera `photoIds` no rascunho; não cria DELETE de mídia. Revisor usou cópia de B e confirmou que B original não foi alterado. | Atendido. |
| 4 | Relatório suplementar desliga os dez widgets, salva/recarrega e restaura/salva/recarrega sem perder opções. Desativar não apaga dados; após correção, também não apaga draft numérico inválido. Revisor conferiu o toggle/recuperação de Recados, além dos relatórios de todos os grupos. | Atendido. |
| 5 | Executor comprovou tema/paleta customizada, relógio/fundos/tamanhos/fuso/refresh após save/reload. A regra de troca de tema não foi alterada e só substitui valores que ainda correspondem ao default anterior. Screenshots e dados persistidos conferidos. | Atendido. |
| 6 | Label de rascunho, mesmo iframe nas trocas, fotos/ordem/configuração enviadas sem save implícito. Revisor capturou mensagens reais com origem estrita e sem `token`, `credential` ou `deviceId`, e mediu orientações nos dois viewports. Sem publish/device mutation durante edição. | Atendido. |
| 7 | Upload múltiplo real do executor com PNG aceito + TXT inválido: sucesso preservado como pending e erro identifica `upload-invalid.txt`, sem reenvio/seleção automática. Código mantém sucessos, continua por arquivo e respeita tipos/12 MB. O roteiro de rede confirma o POST, sem chamar publicação. | Atendido. |
| 8 | Alterações limitadas a componentes/CSS, helpers/teste e documentação/evidências; sem mudança em contratos, endpoints, auth, schema, player ou APK. | Atendido no diff. |

### Roteiro independente final e isolamento

Comando executado da raiz:

```powershell
node "C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase02-browser-20261107\sol-phase02-final.mjs"
```

- Chromium **156.0.8078.4**, CDP nativo via Node, sem instalar dependências.
- Next somente **127.0.0.1:43197** e CDP **127.0.0.1:43198**, perfil próprio.
  SQLite/storage e caminhos auxiliares explicitamente dentro do sandbox Temp.
  Criada uma cópia de painel fixture pela API existente, não modificados dados reais.
- Resultado: **código 0**, **15 verificações**, **`errors=[]`**, **272 requests**
  registrados por método/caminho, nenhum endpoint de publicação/pareamento.
- Regressões de R07 testadas com valores externos via PUT/revisão esperada e polling
  real; o estado canônico atualizado não foi simulado por alteração direta de DOM.
- O roteiro final teve duas falhas intermediárias no próprio harness: filtro
  textual que excluía “Processando” e espera de reload que consultava DOM anterior.
  Corrigidos o critério/espera do teste, sem alterar a aplicação para satisfazê-los.
  A execução final completou todas as assertions.
- Viewports **1440×1000** e **390×844**. Retrato: **437,5×700** e **370×592**;
  paisagem: **745,25×465,78125** e **370×231,25**. Razões 0,625 e 1,6.
  `scrollWidth` **1425 ≤ 1440** no desktop e **390 = 390** no móvel.
- Processos próprios encerrados por PID e ausência de listeners de revisão
  confirmada nas portas 43197/43198. Nenhum serviço alheio foi encerrado.

### Evidências independentes preservadas

- [Relatório final do Sol](evidencias/fase-02/sol-final-review-20261107.json)
- [Retrato desktop](evidencias/fase-02/sol-final-portrait-1440-20261107.png)
- [Paisagem desktop](evidencias/fase-02/sol-final-landscape-1440-20261107.png)
- [Retrato móvel](evidencias/fase-02/sol-final-portrait-390-20261107.png)
- [Paisagem móvel](evidencias/fase-02/sol-final-landscape-390-20261107.png)
- [Fotos/ajuda/ações no móvel](evidencias/fase-02/sol-final-mobile-photos-20261107.png)

Também avaliados os relatórios do executor
`phase02-browser-report-20261107.json` (26 checks/282 requests),
`phase02-widget-toggle-report-20261107.json` (2 checks de persistência/2 saves) e
`phase02-numeric-lifecycle-fix-20261107.json` (5 checks/117 requests), todos com
array de erros vazio. Capturas contêm apenas dados sintéticos, sem credenciais
ou códigos de pareamento. Os relatórios de falhas anteriores foram preservados.

### Comandos automatizados finais

Windows, Node **24.19.0**, npm **11.17.0**. `npm run check` executado novamente
pelo revisor após as últimas correções e a validação de navegador:

- `npm run lint`: aprovado.
- `npm run typecheck`: aprovado na raiz e no workspace web.
- `npm test`: **18 arquivos / 110 testes aprovados**.
- `npm run test:player`: **34 testes aprovados**.
- `git diff --check`: aprovado; apenas avisos informativos LF/CRLF.

Não foi executado build (obrigatório na fase final), deploy, commit, migração de
instalação, publicação, pareamento ou operação em tablet real. Os scripts CDP
permanecem no sandbox como evidência local, sem introduzir infraestrutura E2E ou
dependência no projeto. Os testes Vitest de helpers não foram chamados de testes
de interação React.

### Veredito final

**APROVADA.** Oito critérios de aceite atendidos com evidências suficientes e
F02-R01–R08 encerrados; nenhum achado crítico, alto ou médio aberto nesta revisão.

Limitações: Chromium headless, sem teclado físico, leitor de tela, outro motor de
browser ou tablet. A prévia menor usa o player real e pode comprimir/clipping de
conteúdo com muitos widgets; não é apresentada como reprodução pixel a pixel de
todo tablet. Não houve mudança do player para disfarçar essa limitação. A cobertura
de tablet e acabamento global pertence às etapas correspondentes, não foi alegada
como validada aqui.

A dependência documental da fase 03 está satisfeita, mas **não há avanço
automático**. Fase 03 permanece planejada/não iniciada, aguardando comando do usuário.
