# Fase 01 — revisão

Responsável: Sol-6.1 (GPT-6.1 Sol, revisão independente após execução do Luna-6).
Data: 2026-11-06.
Referência: diff local contra `b30e5125c68f66136086a3391c906c1cb3adf095`, sem commit.
Escopo: somente fase 01; nenhuma implementação da fase 02 ou autorização de avanço automático.

**Veredito atual: APROVADA**, após correções do Luna-6 e reavaliação independente
do Sol-6.1 em 2026-11-06, registrada ao final deste arquivo. O primeiro parecer
abaixo é mantido como histórico. A fase 02 não foi iniciada; aguarda comando do usuário.

## Material e método

- Lidos `docs/ui-ux/README.md`, plano completo da fase 01, registro de execução,
  `apps/web/AGENTS.md`, guia CSS do Next instalado
  (`node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`),
  `/layouts/page.tsx`, editor online, editor de widgets adicionais, estilos e
  `docs/PERSONALIZATION.md`.
- Conferidos `git status --short`, diff integral dos dois arquivos de código,
  handlers, effects, limites das seções, prévia e configuração dos testes.
- Estado recebido: dois arquivos de código modificados e `?? docs/ui-ux/`.
  A documentação já existia antes da execução e foi preservada. Esta revisão
  acrescenta este registro e atualiza apenas situação/checklist da documentação;
  não corrige a implementação.
- O diff de implementação contém 74 inserções e 45 remoções nos dois arquivos de
  código; não há novos componentes, helpers nem testes de interação React.

## Critérios de aceite e evidências

| Critério | Constatação independente | Resultado |
| --- | --- | --- |
| 1. Identificar painel e grupos | Seletor “Painel em edição”, nome na prévia, estado do rascunho e navegação Fotos/Widgets/Aparência presentes. | Evidência estática favorável; usabilidade visual pendente. |
| 2. Controles originais alcançáveis | Diff não remove handlers ou controles; ações secundárias usam `details/summary`; `LocalWidgetEditor` mantém recados, contagem, aniversários, tarefas e pomodoro. | Preservação estática confirmada; acesso real por teclado pendente. |
| 3. Troca de seção preserva rascunho/prévia | Único novo estado é `editorSection`. A troca altera esse estado; wrappers usam `hidden`, sem renderização condicional dos editores ou da prévia. | Favorável por inspeção; fluxo obrigatório não reproduzido. |
| 4. Criar/salvar sem dispositivo | Criação não exige `deviceId`; `save(false)` não o exige; publicação mantém guarda e botão desabilitado sem destino. | Favorável por inspeção; fluxo obrigatório não reproduzido. |
| 5. Teclado e foco | Botões nativos com `aria-pressed`, expansão nativa e CSS `:focus-visible`; não há tabs/menu ARIA incompletos. Há regressão de legibilidade (R01). | Não aceito; faltam também evidências de teclado/foco. |
| 6. Sem overflow em 390/1440 px | Breakpoints foram acrescentados, mas não há medição nem screenshots. `.online-device-actions` continua sendo uma linha flex sem quebra; precisa ser exercitada com dispositivo selecionado, não somente tela vazia. | Não validado; não se afirma overflow observado. |
| 7. Contratos e player preservados | Diff restrito ao estado de navegação, JSX de apresentação e CSS administrativo. Endpoints, payloads, `expectedRevision`, autenticação, schema e player não foram alterados. | Atendido no diff. |

Os effects de polling, seus cleanups, `operation.current`, proteção de resposta por
seleção, confirmação de troca com `dirty` e `beforeunload` não foram modificados.
Não foi encontrada duplicação nova de `config`/`dirty` nem remontagem causada pela
troca de seção. Isso é análise estática, não prova de interação no navegador.

## Achados

### R01 — Média — Regressão de contraste em controles ativos

- **Localização:** `apps/web/src/app/editor.css:525-529`, `:591-595`,
  `:647-649` e `:545-546`; botões em
  `apps/web/src/components/online-frame-editor.tsx:1060-1079` e `:1368-1376`.
- **Evidência:** a regra base mudou o texto de branco para `var(--green)`
  (`#315e49`). As regras de “Exibir neste dispositivo” e “Remover” ainda definem
  somente fundos escuros (`#16803c` e `#475569`), sem substituir a cor do texto.
  O cálculo sRGB dos valores declarados resulta em **1,48:1** e **1,02:1**,
  respectivamente. A navegação inativa nova usa `#78827b`, com **3,98:1** até
  sobre branco; sobre o fundo real `--bg` o contraste é ainda menor.
- **Impacto:** rótulos de ações ficam pouco legíveis, inclusive publicação e
  remoção de pares quando habilitadas. Texto normal requer contraste de 4,5:1;
  acessibilidade não pode ser adiada para a fase 05.
- **Correção esperada:** definir pares de texto/fundo contrastantes nas variantes
  e regras específicas; conferir também navegação inativa e estados habilitados.
  Revalidar visualmente com conteúdo e destino de desenvolvimento selecionado.

### R02 — Média — Sucesso sem região anunciável

- **Localização:** `apps/web/src/components/online-frame-editor.tsx:746`.
- **Evidência:** `notice` continua sendo inserido em um `div` sem `role="status"`
  ou `aria-live`; o indicador novo do rascunho também não é uma região de status.
  O próprio registro do executor reconhece a pendência.
- **Impacto:** sucesso ao salvar/criar/publicar não tem anúncio programático
  garantido; a tarefa 01.5 permanece incompleta.
- **Correção esperada:** implementar uma única região de status, preferencialmente
  persistente e atualizada por mensagem, evitando anúncios duplicados; conferir
  anúncio após operações e manutenção do foco.

### R03 — Média — Carregamento inicial ainda confundido com ausência de dados

- **Localização:** `apps/web/src/components/online-frame-editor.tsx:43-54`,
  `:195-219`, `:702-709`, `:747-753`;
  `docs/ui-ux/01-organizacao-e-base-visual.md:79`.
- **Evidência:** dispositivos e painéis iniciam em arrays vazios; o carregamento
  dessas listas não tem estado próprio. `loading` é usado apenas na seleção de
  um painel. Ao abrir a área secundária com a requisição pendente, a condição
  `!devices.length` já oferece “Nenhum dispositivo vinculado”; uma falha mantém
  essa condição junto do erro. O checklist marca a separação como concluída,
  mas ela só existe para o detalhe do painel, não para as listas iniciais.
- **Impacto:** ausência e erro/carregamento inicial continuam indistintos,
  descumprindo 01.5 e oferecendo orientação enganosa em rede lenta ou falha.
  É uma lacuna preexistente que a fase se comprometeu a resolver, não uma
  regressão atribuída ao novo wrapper.
- **Correção esperada:** distinguir carregando, carregado-vazio e erro nas fontes
  iniciais; oferecer próximo passo/retentativa coerente, sem alterar contratos.
  Atualizar o checklist somente com evidência correspondente.

### R04 — Média — Extração por responsabilidade não executada

- **Localização:** `apps/web/src/components/online-frame-editor.tsx:607-1412`;
  tarefa 01.3 do plano e regras técnicas do README.
- **Evidência:** o diff apenas envolve o JSX existente com novas seções e insere
  a navegação/cabeçalho diretamente no componente monolítico. Não foi criado
  componente concreto de cabeçalho, navegação, seções ou feedback com props
  tipadas; o `LocalWidgetEditor` já existia.
- **Impacto:** a entrega de organização estrutural explicitamente prevista não
  foi concluída, apesar da separação visual inicial.
- **Correção esperada:** extrair apresentações concretas por responsabilidade,
  mantendo configuração, seleção e operações no proprietário atual. Não criar
  abstrações vazias nem copiar estado; preservar montagem e bloqueios.

### R05 — Média — Evidências obrigatórias de navegador ausentes

- **Localização:** `docs/ui-ux/registros/fase-01-execucao.md:35-39`;
  critérios 1–6 e seção de verificação do plano; README, protocolo de aprovação.
- **Evidência:** execução e revisão não dispõem de ferramenta de navegador.
  Resolução local de `playwright`, `@playwright/test` e `puppeteer` não encontrou
  esses pacotes. Nenhuma nova dependência foi instalada. Não há screenshots,
  medição de overflow, reprodução de teclado ou fluxo preenchido registrado.
- **Impacto:** não se pode aprovar interação, foco, preservação do rascunho ou
  responsividade com testes Node e leitura de código.
- **Ação/evidência solicitada ao usuário:** disponibilizar navegador ou registrar
  manualmente, em dados isolados de desenvolvimento, `/` e `/layouts` em
  **390 px e 1440 px**, com conteúdo preenchido: criar e salvar sem dispositivo;
  editar campo/seleção de fotos; alternar as três seções e confirmar campo e
  prévia preservados; cancelar troca de painel sujo; testar aviso ao recarregar;
  abrir/fechar o menu por teclado e verificar foco/controles ocultos; acessar
  todos os widgets adicionais e área secundária. Medir ausência de overflow e
  acesso às ações, incluindo com dispositivo de teste selecionado, sem publicar
  ou parear tablet real. Registrar passos, resultados e screenshots sem códigos
  de pareamento ou credenciais.

## Comandos e resultados independentes

Ambiente: Windows, Node **v24.19.0**, npm **11.17.0**, compatíveis com o projeto.

| Comando | Resultado da revisão |
| --- | --- |
| `git status --short` / `git diff --stat` / `git diff -- apps/web/src/components/online-frame-editor.tsx apps/web/src/app/editor.css` | Diff examinado integralmente; alterações existentes preservadas. |
| `git rev-parse HEAD` | `b30e5125c68f66136086a3391c906c1cb3adf095`. |
| `npm run check` | Sucesso, código 0; agregou os quatro comandos abaixo. |
| ↳ `npm run lint` | Sucesso. |
| ↳ `npm run typecheck` | Sucesso na raiz e no workspace web. |
| ↳ `npm test` | **17 arquivos, 107 testes aprovados**. |
| ↳ `npm run test:player` | **34 testes aprovados**. |
| `git diff --check` | Sucesso; somente avisos do Git sobre futura conversão LF/CRLF nos dois arquivos de código. |
| `node -e` para versão/resolução de módulos | Node compatível; Next resolvido na raiz; três bibliotecas de navegador não disponíveis. |
| `npm --version` | `11.17.0`. |
| `node -e` com luminância sRGB dos pares de cores de R01 | `1.48:1`, `1.02:1`, `3.98:1`; cálculo sobre CSS declarado, não medição de screenshot. |

O cálculo usado foi `(Lmax + 0.05) / (Lmin + 0.05)`, com canais sRGB
linearizados e pesos `0.2126`, `0.7152`, `0.0722`. As cores e regras que o
originaram estão identificadas em R01.

Conferidos `vitest.config.ts` e `tests/global-setup.ts`: a suíte gera nomes UUID
para SQLite/armazenamento de teste e aplica migrações nesse ambiente isolado.
Não foi executado `db:migrate` contra instalação real. Não foram executados
build, deploy, commit, pareamento nem publicação em dispositivo real. O build
é obrigatório na fase final, não nesta revisão.

## Pendências e veredito — primeira rodada (superada pela reavaliação)

**AJUSTES NECESSÁRIOS.** R01–R05 permanecem abertos, todos de severidade média e
bloqueantes segundo o protocolo. Não foram encontrados achados críticos ou altos
no diff inspecionado; isso não substitui as validações ausentes. O baseline
visual anterior à implementação não foi registrado e não pode ser reconstruído
como evidência retroativa.

Luna-6 deverá corrigir as lacunas da **fase 01**, registrar as validações e
submeter nova revisão ao Sol-6.1. A fase 02 permanece **não liberada** e não foi
implementada nesta revisão.

## Reavaliação pós-correções — 2026-11-06

Responsável: Sol-6.1. Mesmo HEAD de referência, sem commit. Diff acumulado de
código: 127 inserções e 72 remoções em `online-frame-editor.tsx` e `editor.css`.
O registro inicial e as falhas intermediárias do executor foram preservados.

### Reavaliação dos achados

| Achado | Evidência independente atual | Situação |
| --- | --- | --- |
| R01 — Contraste | Cor branca explícita nas regras dos botões escuros. Recalculados publicação 5,02:1, remoção de moedas 7,58:1, primário 7,43:1, destrutivo 6,37:1, secundário 8,54:1; navegação habilitada 9,23:1 sobre `--bg`. Conferidos também computed styles coletados pelo executor no Chromium. | Resolvido. |
| R02 — Status | `EditorFeedback`, linhas 34–39, mantém uma região `role=status`, `aria-live=polite`, `aria-atomic=true` montada; erro em alerta separado. Em navegador, salvamento atualizou a mesma região e foi contada uma única instância. | Resolvido na implementação; não se alega audição por leitor de tela. |
| R03 — Loading/vazio/erro | `listStatus` distingue as três listas. Revisor reteve requests por CDP e confirmou carregamento sem vazio falso; injetou HTTP 503 e confirmou erro → retentativa → vazio para dispositivos, painéis e fotos. Depois repetiu fluxo com dados reais da fixture isolada. | Resolvido. |
| R04 — Componentes | `EditorFeedback` e `EditorSectionNavigation` são componentes concretos, tipados e definidos fora do componente proprietário. A pasta proposta não foi necessária. Estado/configuração/operações continuam no proprietário; iframe e seções não remontam ao navegar. | Resolvido. |
| R05 — Navegador | Chromium instalado fora do PATH foi localizado e usado sem instalação de dependências. Revisor executou roteiro próprio com assertions e screenshots, não apenas repetiu a conclusão do executor. | Resolvido para os critérios desta fase. |

### Ambiente, isolamento e reprodução

- Chromium headless **156.0.8078.4**, CDP com Node nativo `fetch`/`WebSocket`;
  nenhuma dependência DOM/E2E adicionada ao projeto.
- Banco SQLite e mídia exclusivamente da fixture temporária preparada pelo
  executor em
  `C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase01-browser-20261106`.
  O revisor explicitou `DATABASE_URL` para `data-final/smartframe.db`, armazenamento
  para `storage-final` e caminhos auxiliares dentro desse mesmo sandbox. Nenhuma
  migration adicional ou consulta a banco real foi executada pelo revisor.
- Next em **127.0.0.1:43189**; CDP em **127.0.0.1:43190**; perfil separado
  `sol-profile`. Login desabilitado somente nesse processo de teste em loopback,
  com administrador fixture explícito. Processos próprios encerrados por PID ao
  final, sem interferir em serviço do usuário.
- Script independente autocontido de inicialização, teste e encerramento:
  `sol-review.mjs`, no diretório temporário acima. Comando executado da raiz:

  ```powershell
  node "C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase01-browser-20261106\sol-review.mjs"
  ```

- Resultado: **código 0; 16 verificações aprovadas; array de erros vazio** em
  `sol-review-report.json`. O script cria/salva somente painel de fixture e não
  executa publicação, pareamento ou revogação. Não deve ser adaptado para produção.
- A primeira tentativa do roteiro do revisor abortou por uma assertion incorreta
  do próprio teste (`scrollWidth === innerWidth`): no desktop havia 1425 px de
  conteúdo para viewport de 1440 px, pela barra vertical. Corrigida a condição
  para `scrollWidth <= innerWidth`, que expressa ausência de overflow. A segunda
  execução completou integralmente; não houve correção de aplicação por esse motivo.

### Critérios de aceite — resultado final

1. **Atendido:** painel selecionado identificado, grupos Fotos/Widgets/Aparência
   visíveis; screenshots preenchidos inspecionados pelo revisor.
2. **Atendido:** controles preservados no diff; cinco grupos adicionais presentes
   e seção Widgets acessível. Área secundária exercitada com dispositivo fixture.
3. **Atendido:** editada cidade, selecionada foto, alternadas as três seções;
   campo e checkbox mantidos, mesma instância de iframe e imagem da fixture
   efetivamente renderizada na prévia. Cancelar troca manteve painel/rascunho;
   recarregar gerou `beforeunload` real, recusado via CDP, conservando o campo.
4. **Atendido:** criado painel pelo prompt nativo, editado e salvo com dispositivo
   vazio. GET do detalhe confirmou cidade, uma foto e revisão 2 persistidas;
   publicação permaneceu desabilitada sem destino. Não se publicou em tablet.
5. **Atendido:** `Space` abriu/fechou menu nativo; `Tab` entrou em “Duplicar” com
   outline sólido; `Tab` e `Space` ativaram Widgets. Mais 45 deslocamentos de foco
   não entraram nas seções ocultas. Enter sintético não ativou o summary no teste
   do executor, mas não existe handler que o suprima e o caminho nativo por Space
   foi reproduzido. Não se afirma validação de teclado físico/leitor de tela.
6. **Atendido:** `/` em 1440×1000 e 390×844; `/layouts` nas mesmas dimensões, com
   dispositivo fixture e área secundária aberta, nas três seções. Desktop:
   `scrollWidth=1425 <= innerWidth=1440`; móvel: `390=390`. Nenhum botão visível
   do editor ultrapassou horizontalmente a viewport. Screenshots de página inteira
   permitem conferir também as ações abaixo da dobra, acessíveis por rolagem.
7. **Atendido:** diff preserva contratos, endpoints, payloads, autenticação, schema
   e player. Novos estados são apenas de apresentação/carregamento de listas.

As novas mensagens de erro/retentativa não foram tratadas como testes Node de
interação: foram exercitadas no navegador real com interceptação de rede no
próprio browser. Guards de operações, revisão esperada, polling e proteção de
seleção foram também reconferidos no diff, sem mudança nas regras existentes.

### Evidências preservadas no repositório

Screenshots copiados sem sobrescrever arquivos preexistentes, usando apenas
dados de fixture e sem credenciais/códigos de pareamento:

- [Início 1440 px](evidencias/fase-01/home-1440.png)
- [Início 390 px](evidencias/fase-01/home-390.png)
- [Editor Fotos 1440 px](evidencias/fase-01/layouts-1440-fotos.png)
- [Editor Aparência 1440 px](evidencias/fase-01/layouts-1440-aparencia.png)
- [Editor Widgets 390 px](evidencias/fase-01/layouts-390-widgets.png)
- [Listas vazias após erro e retentativa](evidencias/fase-01/listas-vazias.png)

Relatórios brutos e scripts de teste estão no sandbox temporário citado acima;
não constituem nova infraestrutura E2E ou dependência do projeto.

### Validações automatizadas após o navegador

`npm run check` executado novamente pelo revisor: **sucesso**, incluindo lint,
typecheck na raiz/web, **17 arquivos / 107 testes Vitest** e **34 testes do
player**. `git diff --check`: **sucesso**, somente avisos informativos LF/CRLF.
`git status --short` continua restrito aos dois arquivos de implementação e
`?? docs/ui-ux/`; desenvolvimento em Next não introduziu mudanças adicionais
rastreadas. Sem build, deploy, commit ou alteração em dados reais.

### Achado residual não bloqueante

**R06 — Baixa — Região de sucesso vazia conserva decoração.**
Localização: `apps/web/src/components/online-frame-editor.tsx:37` e
`apps/web/src/app/editor.css:685-703`. A região persistente vazia conserva padding,
margem e fundo verde, produzindo uma faixa sem texto (visível no screenshot de
listas vazias). Impacto cosmético, sem perda de controles ou anúncio duplicado.
Correção recomendada: retirar decoração/espaçamento quando vazia, preservando
a região montada e anunciável. Não usar ocultação que impeça anúncios futuros.
Pequenos refinamentos de espaçamento seguem como acabamento não bloqueante.

### Veredito atualizado

**APROVADA.** Critérios 1–7 atendidos nas condições e viewports registrados;
R01–R05 encerrados; nenhum achado crítico, alto ou médio aberto. R06 permanece
como baixa severidade, sem impedir o uso ou descumprir critério de aceite.

Limitações explícitas: sem auditoria anterior à implementação (não apresentada
retroativamente), sem leitor de tela/teclado físico, sem outro motor de browser
e sem teste de tablet real. Esses testes adicionais não são tratados como
concluídos nem substituem as exigências de fases posteriores.

A aprovação satisfaz a dependência documental da fase 02, **mas não autoriza
avanço automático**. A fase 02 permanece planejada e não iniciada, aguardando
instrução do usuário.
