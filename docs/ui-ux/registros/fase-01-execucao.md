# Fase 01 — execução

Responsável: Luna-6
Data: 2026-11-06
Referência do diff/commit, quando houver: alterações locais sem commit.
Escopo verificado: organização da tela `/layouts`, mantendo estado e operações existentes; não houve avanço à fase 02.

## Resumo e arquivos alterados

- `apps/web/src/components/online-frame-editor.tsx`: cabeçalho agora identifica o rascunho, criação fica em ação primária e duplicar/renomear/excluir ficam em expansão nativa; dispositivos, permissões e pareamento estão agrupados em área secundária. As opções passaram a ser organizadas em Fotos, Widgets e Aparência com botões `aria-pressed`. Seções ocultas usam `hidden`, permanecendo montadas para conservar estado e evitar efeitos/remontagens extras. Handlers, configuração, preview, bloqueios, confirmação de alterações e revisão esperada foram preservados.
- `apps/web/src/app/editor.css`: identidade verde da administração no editor, estados e navegação com foco, e ajustes responsivos locais ao editor. Sem mudanças no tema/configuração do player.
- `docs/ui-ux/01-organizacao-e-base-visual.md`: atualização do checklist de execução; itens cuja validação não ocorreu permanecem pendentes.
- `docs/ui-ux/registros/fase-01-execucao.md`: este registro.

## Critérios e evidências

- Hierarquia: implementada no JSX; inspeção estática confirma acesso às três seções e controles mantidos no DOM. Não é evidência de fluxo funcional em navegador.
- Preservação do rascunho: a troca de seção só altera estado de navegação; conteúdos permanecem montados e ocultos via atributo HTML. Sem teste interativo de navegador.
- Operações assíncronas, `expectedRevision`, polling, bloqueio contra duplicidade e confirmação de troca não foram alterados nesta implementação.
- Sem dispositivos: o botão de criação permanece disponível sem dispositivo, e o salvamento de rascunho não exige `deviceId`; publicação segue exigindo destino.
- Acessibilidade visual: botões nativos, `aria-pressed`, `summary/details` nativos e foco explícito foram implementados. Teclado/foco real não validado.
- Responsividade: CSS contém breakpoint móvel e colunas adaptativas; overflow a 390 px e distribuição a 1440 px não foram medidos em navegador.
- Não foram alterados payloads, endpoints, autenticação, schema, persistência nem player.

## Ambiente, comandos e resultados

- Ambiente: Windows; Node `v24.19.0`, npm `11.17.0` (compatíveis com os requisitos do projeto). `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` lido conforme as instruções locais.
- `git status --short` no início: somente `?? docs/ui-ux/`; árvore fornecida pelo solicitante preservada. Os arquivos de código foram limpos antes da execução; o diretório de documentação permaneceu intacto, exceto pelos arquivos explicitamente requeridos no protocolo.
- `npm run lint`: sucesso.
- `npm run typecheck`: sucesso (tsc da raiz e workspace web).
- `npm test`: sucesso, 17 arquivos e 107 testes.
- `npm run test:player`: sucesso, 34 testes.
- `git diff --check`: sucesso; apenas avisos de conversão de LF para CRLF do Git nos dois arquivos de código.

## Validação no navegador e limitações

Não executada. Não havia ferramenta de navegador disponível nesta sessão; portanto `/`, `/layouts`, viewport desktop/celular, conteúdo preenchido, persistência ao alternar seções, cancelamento de troca, menu por teclado e foco visível seguem **não validados**. Também não foi feita auditoria visual de baseline antes da mudança. Não foram usados dados reais, não houve pareamento/publicação em tablet, deploy ou commit.

Achados/pontos para revisão independente: a tela atualmente mantém as três seções montadas via `hidden` (incluindo o editor de widgets adicionais), uma escolha intencional para não resetar o estado; revisar possíveis impactos de tabulação/foco e layout. O estado vazio/carregamento/erro anterior foi mantido, mas mensagens de sucesso ainda não usam região `aria-live`; esse item do plano segue pendente.

Veredito: não aplicável (registro de execução; revisão Sol-6.1 pendente). A fase 02 não foi iniciada.

## Correção pós-revisão (2026-11-06)

Escopo: correções exclusivamente dos achados R01–R04 da revisão Sol-6.1. R05 foi investigado sem instalar dependências; validação real de navegador continua pendente. A fase 02 não foi iniciada.

- **R01:** texto padrão de botões e navegação inativa agora usa cores escuras sobre fundo claro; variantes primária, destrutiva, remoção de pares e disponibilização mantêm texto branco sobre fundos escuros. Ações de dispositivo quebram linha e ajustes móveis reduzem risco de overflow. Não há medição de contraste via browser; cálculo estático baseado nos valores CSS: texto #4b554e sobre branco ≈ 8,0:1; texto #244b36 sobre #eaf1e7 ≈ 8,5:1; branco sobre #16803c ≈ 5,0:1; branco sobre #475569 ≈ 7,6:1; branco sobre #a33e34 ≈ 6,5:1.
- **R02:** extraído `EditorFeedback`, com região de status permanente única `role="status"`, `aria-live="polite"` e `aria-atomic="true"`; a mensagem vazia evita anúncio inicial e success/notice atualiza a mesma região. Erros permanecem em alerta separado.
- **R03:** listas iniciais de dispositivos, painéis e fotos distinguem `loading`, `ready` vazio/preenchido e `error`; erro de cada lista oferece retentativa ao endpoint existente. Estados vazios orientam a ação seguinte. Requests, rotas e payloads não foram alterados.
- **R04:** apresentação de navegação e feedback extraída para `EditorSectionNavigation` e `EditorFeedback`, ambos componentes concretos com props explícitas/tipadas. Estado de seção, `config`, `dirty`, dados e operações continuam no proprietário; seções de formulário mantêm-se montadas.
- **R05 / navegador:** `require.resolve` confirmou `playwright`, `@playwright/test`, `puppeteer` e `selenium-webdriver` indisponíveis; comandos `msedge`, `chrome` e `firefox` também não estão disponíveis no PATH. Nenhuma dependência foi instalada e nenhum resultado visual/interativo é alegado.

### Validação pós-correção

- Ambiente: Windows; Node `v24.19.0`, npm `11.17.0`.
- `npm run check`: sucesso; lint, typecheck, 17 arquivos/107 testes Vitest e 34 testes do player aprovados.
- `git diff --check`: sucesso (avisos informativos de conversão LF/CRLF nos dois arquivos de código).
- Validação de navegador em `/` e `/layouts`, nos viewports 390 px e 1440 px, com conteúdo e dispositivo de teste: **não realizada**. Foco, teclado, anúncio por tecnologia assistiva, persistência interativa e overflow continuam sem evidência.

### Pendência para revisão independente

Sol-6.1: revisar o diff da correção, especificamente contraste de todos os estados habilitados/desabilitados, anúncio sem duplicidade, transições erro→retentativa→vazio/preenchido, preservação de estado e contratos. A aprovação segue bloqueada pela evidência de navegador. Solicitar ao usuário a execução manual descrita em `fase-01-revisao.md` (390 px e 1440 px, criação/salvamento sem dispositivo, alternância das três seções, proteção de rascunho, menu por teclado, widgets e área secundária), com screenshots sem credenciais/códigos de pareamento. Fase 02 não liberada.

## Retificação da investigação de navegador — 2026-11-06

A conclusão acima de que não havia navegador disponível foi imprecisa: os checks anteriores cobriram apenas resolução de módulos Node e executáveis no `PATH`. Verificação posterior com `Test-Path` confirmou Chrome em `C:\Program Files\Google\Chrome\Application\chrome.exe`, Edge em `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` e browsers Playwright instalados sob `C:\Users\Edalicio\AppData\Local\ms-playwright`; foi localizado Chromium `chromium-1248\chrome-win64\chrome.exe`. Nenhuma instalação/download foi feita.

Para tentativa isolada foram criados diretórios exclusivamente em `C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase01-browser-20261106`. Migrations foram aplicadas apenas a `data-final\smartframe.db` (as cinco migrations do repositório); banco e armazenamento são temporários, separados da instalação. Fixture isolada contém proprietário `phase01@example.invalid`, dois painéis, um dispositivo de teste e uma imagem otimizada de fixture. Nenhum tablet, dado ou serviço real foi usado. O ambiente planejava `SMARTFRAME_ADMIN_LOGIN=disabled`, `SMARTFRAME_ADMIN_EMAIL=phase01@example.invalid`, `BETTER_AUTH_URL=http://127.0.0.1:43187` e bind explícito `127.0.0.1`; portanto o login sem sessão ficaria restrito à proteção loopback verificada em `packages/auth/src/local-panel.ts`.

A tentativa **não chegou ao navegador**: o processo Next encerrou imediatamente com `Error: Cannot find module 'D:\dev\projetos\Edalicio\SmartFrame\apps\web\node_modules\next\dist\bin\next'` (Node v24.19.0). O comando executado apontou o caminho do CLI como `node_modules/next/dist/bin/next` relativo a `apps/web`, mas a dependência está instalada na raiz. Não houve HTTP response local, sessão CDP, interação, medição de `scrollWidth`, nem screenshot. Seguindo a instrução de parar em falha do processo externo, a execução foi interrompida sem nova tentativa. Assim, resultados de `/`, `/layouts`, 390/1440 px, rascunho, controles, teclado/foco e acesso secundário permanecem **não validados**; a aprovação de R05 continua pendente.

Durante a preparação, duas tentativas de seed isoladas falharam antes do processo Next: (1) import de caminho Windows sem URL `file:` (`ERR_UNSUPPORTED_ESM_URL_SCHEME`); (2) fixture PNG inválida (`vipspng: libpng read error`). Foram usadas novas pastas temporárias para a fixture final; nenhuma dessas falhas tocou o banco da instalação. A tentativa seguinte chegou a criar a fixture final com imagem válida; depois o Next falhou conforme descrito acima. Não foram removidos diretórios temporários nem arquivos de perfil.

**Evidências de navegador/screenshot:** nenhuma gerada. Permanecem solicitadas ao usuário as evidências detalhadas no registro de revisão, agora com Chromium local identificado e disponível para uma nova tentativa após corrigir o comando de inicialização. A frase anterior sobre indisponibilidade deve ser lida como conclusão inicial baseada somente em PATH, supersedida por esta retificação; não houve validação visual/interativa nesta sessão.

## Retomada autorizada — validação real em Chromium (2026-11-06)

O usuário autorizou corrigir o caminho do CLI e reutilizar exclusivamente `data-final` e `storage-final` sob o diretório temporário acima. O comando de desenvolvimento foi iniciado de `apps/web` com o CLI absoluto `D:\dev\projetos\Edalicio\SmartFrame\node_modules\next\dist\bin\next`, `--hostname 127.0.0.1 --port 43187`. Ambiente confirmado: `DATABASE_URL=file:C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase01-browser-20261106\data-final\smartframe.db`, STORAGE_PATH e configurações auxiliares também em Temp. `Get-NetTCPConnection` confirmou listeners somente em `127.0.0.1:43187` (Next) e `127.0.0.1:43188` (CDP); não houve bind público. `SMARTFRAME_ADMIN_LOGIN=disabled` foi usado somente neste processo loopback e com proprietário fixture explicitamente selecionado. `GET /` respondeu HTTP 200. Nenhuma chamada executou publicação, pareamento ou revogação.

- **Browser/método:** Chromium headless do Playwright local, Chrome `156.0.8078.4`, `HeadlessChrome/156.0.8078.4`; execução com Node nativo `fetch` e `WebSocket` (CDP), sem Playwright API, download ou dependências instaladas.
- **Viewports:** `/` e `/layouts` em 1440×1000 e 390×844 CSS px. Nos quatro casos `document.documentElement.scrollWidth === innerWidth` (1440/1440 ou 390/390): sem overflow horizontal da página. Em `/layouts` a área com dispositivo selecionado e ações permaneceu dentro dos 390 px; ambas as ações secundárias ficaram visíveis/acessíveis.
- **Dados isolados:** painel A/B, dispositivo, imagem pronta e administrador criados exclusivamente na fixture `data-final`/`storage-final`. O banco test-only recebeu migrations do projeto; não se apontou nem leu banco de instalação.
- **Fluxos `/layouts`:** criação pelo botão, preenchimento do prompt e painel selecionado observados; editado o campo Cidade do clima, alternadas Widgets → Aparência → Fotos e confirmado o valor preservado, status sujo e prévia/iframe ainda presente. Selecionada a foto fixture (checkbox mudou para checked). Com dispositivo vazio, “Salvar painel” concluiu e mostrou `Rascunho salvo; o dispositivo não foi alterado.`; revisão observada mudou para r2 e região `role=status` única (uma instância).
- **Proteção do rascunho:** com nova alteração não salva, tentativa de selecionar “Fixture Painel B” abriu confirmação nativa; o handler CDP recusou-a. A seleção permaneceu no painel atual e “Alterações não salvas” continuou visível.
- **Widgets/área secundária:** seção Widgets exibiu os cinco grupos adicionais (Recados, Contagem regressiva, Aniversários, Tarefas e Pomodoro). Selecionado “Fixture Dispositivo 01”; área secundária expandida e permissão carregada pela API existente (`GET /api/devices/panels` HTTP 200); nenhum controle foi usado para disponibilizar/publicar.
- **Teclado/foco:** `Tab` CDP moveu foco do summary “Ações do painel” para “Dispositivos, permissões e pareamento”, fora das seções ocultas, com `outline-style: solid`; `Space` ativou/abriu o `<details>` nativo. Enviar Enter sintético via CDP foi recebido como keydown confiável mas não acionou o summary neste ambiente; o caminho de teclado foi verificado com Tab/Space. Se revisão manual exigir especificamente Enter, permanece uma ressalva de plataforma/automação a confirmar com teclado físico.
- **Reload:** após editar, `Page.reload` gerou evento `beforeunload`; o handler de teste recusou a confirmação e o estado permaneceu protegido.
- **Contraste medido no navegador:** computed styles dos estados ativos produziram texto/fundo: secundário **8,54:1** (`#244b36`/`#eaf1e7`), primário **7,43:1** (branco/`#315e49`), destrutivo **6,37:1** (branco/`#a33e34`), Remover **7,58:1** (branco/`#475569`), disponibilizar **5,02:1** (branco/`#16803c`), desvincular **7,37:1** (branco/`#a32525`). Navegação inativa escura também foi computada sobre o fundo claro. O botão desabilitado “Adicionar par” não foi usado para inferir conformidade, pois controles desabilitados são estado distinto.
- **Sem erros de operação:** respostas observadas para lista/detalhe do painel, dispositivos e widgets foram HTTP 200; criação/salvamento funcionaram. O log do Next não apresentou erro de runtime no trecho revisado.

### Evidências persistidas (sem credenciais/códigos)

Em `C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase01-browser-20261106\screenshots\`:

- `home-1440.png`, `home-390.png`
- `layouts-1440-initial.png`, `layouts-1440-filled.png`, `layouts-1440-secondary-device.png`, `layouts-1440-reload-guard.png`
- `layouts-390.png`, `layouts-390-device-area.png`

Relatório de interações: `browser-report.json`; cores/foco/teclado: `keyboard-contrast-report.json`. Os scripts reutilizáveis sem dependências adicionais são `browser-check.mjs` e `browser-focus-contrast.mjs` no mesmo diretório. Com Next e Chromium iniciados nos endereços/portas loopback referidos, comando: `node C:\Users\Edalicio\AppData\Local\Temp\opencode\smartframe-phase01-browser-20261106\browser-check.mjs`; o script salva screenshots/relatório no diretório isolado e usa somente HTTP local. `browser-focus-contrast.mjs` consulta a página local aberta via CDP. Não executar apontando para produção ou dados fora do sandbox.

**Limitações restantes:** teste em Chromium headless, sem leitor de tela/tecnologia assistiva e sem teclado físico; Enter sintético não ativou o summary, embora Tab e Space tenham funcionado. `beforeunload` foi confirmado pelo evento do browser, não por confirmação humana física. Não houve publicação nem pareamento real. A validação confirma critérios observáveis da fase 01 nestas fixtures/viewports, mas não substitui revisão independente de Sol-6.1. Fase 02 permanece não iniciada e não liberada.

Após a retomada: `npm run check` executado novamente com sucesso (lint, typecheck, 17 arquivos/107 testes Vitest e 34 testes do player); `git diff --check` sucesso, apenas avisos informativos LF→CRLF nos arquivos de código. Os processos Next e Chromium criados para o teste foram encerrados por PID específico; os dados temporários e screenshots foram preservados para revisão.
