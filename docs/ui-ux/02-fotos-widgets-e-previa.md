# Fase 02 — Fotos, widgets, aparência e prévia

- Executor: **Luna-6**.
- Revisor: **Sol-6.1**.
- Dependência: fase 01 aprovada.
- Situação: **APROVADA pelo Sol-6.1 em 2026-11-07 após correções e reavaliação independente**. Fase 03 não iniciada; aguardar comando do usuário. Consulte [execução](registros/fase-02-execucao.md) e [revisão](registros/fase-02-revisao.md).

## Objetivo

Melhorar a configuração do conteúdo do painel, com seleção visual de fotos,
configurações progressivas de widgets e prévia fiel ao rascunho.

## Leitura e arquivos

- `apps/web/src/components/online-frame-editor.tsx` e componentes da fase 01.
- `apps/web/src/components/local-widget-editor.tsx`.
- `apps/web/src/app/editor.css`.
- `apps/web/src/app/api/photos/route.ts` e `api/photos/[id]/image/route.ts` (consulta).
- `packages/contracts/src/` (contrato online, somente consulta).
- `docs/WIDGETS.md` e `docs/PERSONALIZATION.md`.
- `tests/online-dashboard-contract.test.ts`, `tests/local-dashboard-widgets.test.ts`
  e `tests/widget-grid-contract.test.ts`.

Componentes propostos em `apps/web/src/components/online-editor/`: seção de fotos,
seção de widgets, seção de aparência e cartão de prévia. Helpers puros, se úteis,
em `apps/web/src/lib/online-editor/`, com testes em `tests/online-editor-*.test.ts`.

## Tarefas do Luna-6

### 02.1 — Biblioteca e seleção de fotos

- [x] Exibir miniaturas autenticadas das fotos prontas usando o endpoint existente.
- [x] Manter nome do arquivo e indicação textual de seleção; tratar falha da miniatura.
- [x] Não tentar buscar imagem de foto pendente/processando como se estivesse pronta.
- [x] Mostrar quantidade selecionada e limite de 100 fotos previsto pelo contrato.
- [x] Impedir seleção duplicada ou acima do limite com explicação ao usuário.
- [x] Manter upload múltiplo JPEG/PNG/WebP e limite existente de 12 MB por arquivo.
- [x] Mostrar envio e processamento como etapas distintas, sem inventar porcentagem.
- [x] Em falha parcial de lote, preservar fotos já enviadas e identificar o arquivo
      que falhou, sem anunciar sucesso integral nem reenviar o lote automaticamente.
- [x] Traduzir estados de processamento em mensagens legíveis, com fallback seguro
      para estados desconhecidos; preservar atualização manual após expiração do polling.

Não existe exclusão de foto por `DELETE /api/photos/[id]` na API consultada. A ação
**Retirar do painel** altera somente a seleção do rascunho; não criar botão de
exclusão definitiva nem novo endpoint nesta fase.

### 02.2 — Ordem e apresentação do carrossel

- [x] Mostrar a ordem selecionada com miniatura, posição e nome.
- [x] Manter ações mover antes/depois, utilizáveis com teclado e toque.
- [x] Dar nomes acessíveis específicos: por exemplo, “Mover praia.jpg para antes”.
- [x] Desabilitar a direção impossível na primeira e na última posição.
- [x] Reordenar sem perder seleção, duplicar IDs ou trocar a foto errada.
- [x] Manter foco na ação/foto após mudança de posição e anunciar o resultado.
- [x] Explicar Preencher (pode cortar bordas) e Conter (mostra a imagem inteira; podem sobrar áreas de fundo); ajuda associada ao seletor.
- [x] Preservar o intervalo de troca de fotos aceito pelo contrato.

Drag-and-drop não faz parte da entrega obrigatória. Não substituir os botões
acessíveis por uma interação que dependa de arrastar.

### 02.3 — Widgets com configuração progressiva

- [x] Apresentar widgets como grupos com nome, breve descrição e ativação.
- [x] Exibir opções relevantes quando o widget estiver habilitado ou for expandido.
- [x] Desativar/ocultar opções não pode apagar configurações já preenchidas.
- [x] Preservar relógio, clima, moedas, calendário e fotos.
- [x] Preservar recados, contagem regressiva, aniversários, tarefas e pomodoro.
- [x] Manter limites e regras das moedas: 1–20 pares, sem duplicados, origem e
      destino distintos, quantidade exibida e intervalo válidos.
- [x] Manter observação sobre cotações indicativas, sem apresentar dado antigo como atual.
- [x] Agrupar opções avançadas sem ocultar mensagens de validação em seções fechadas.

### 02.4 — Aparência sem regressão de personalizações

- [x] Organizar tema, cores gerais, fundos/tamanhos de widgets, orientação e fotos.
- [x] Fuso e atualização geral ficam em opções avançadas, ainda alcançáveis.
- [x] Preservar a regra existente de troca de tema: cores personalizadas não devem
      ser substituídas indiscriminadamente pelos defaults.
- [x] Preservar fundo padrão por widget, tamanho do cartão e tamanho/cor do relógio.
- [x] Separar visualmente o tema do painel da identidade visual da administração.
- [x] Campo inválido mostra erro legível sem gravar valor coercivamente como zero.

### 02.5 — Prévia do rascunho

- [x] Rotular a área como **Prévia do rascunho**, não como tela atual do dispositivo.
- [x] Preservar iframe e `smartframe:online-preview` com origem restrita à aplicação.
- [x] Preservar consulta autenticada/cache compartilhado dos dados dos widgets no pai;
      não passar credencial de dispositivo nem criar polling autenticado no iframe.
- [x] Refletir fotos, ordem, ativação e aparência sem salvar ou publicar implicitamente.
- [x] Em desktop, manter prévia visível sem impedir a rolagem dos controles.
- [x] Ajustar o contêiner para retrato/paisagem sem distorcer o iframe por transformações.
- [x] Não prometer que uma prévia menor reproduz exatamente todo tablet físico.
- [x] Em celular, permitir alternar configurar/visualizar sem perder estado;
      evitar remontar o iframe a cada troca de seção sem necessidade.

## Critérios de aceite

1. Fotos prontas têm miniatura; fotos em processamento têm estado explícito e não selecionável.
2. Selecionar, retirar e reordenar altera a prévia e mantém IDs únicos, no limite do contrato.
3. Retirar foto de um painel não altera outro painel nem remove a mídia da biblioteca.
4. Todos os widgets, inclusive adicionais, mantêm suas configurações ao serem desativados.
5. Tema, cores e aparência customizada sobrevivem a salvar e recarregar.
6. Prévia acompanha alterações não salvas sem modificar o dispositivo.
7. Erros de upload parcial não apagam os sucessos já recebidos.
8. Nenhuma mudança em contrato, API ou código do player é necessária.

## Testes e cenários

Automatizados:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:player
```

Testes Vitest para helpers extraídos cobrem reordenação nas extremidades, retirada,
limite de seleção e preservação dos IDs; a aplicação usa os mesmos helpers.

No navegador, os cenários acima foram reproduzidos em Chromium real com fixture
SQLite/storage isolada. Também foram testados limite 100/101, retirada A sem alterar
B/biblioteca, campos vazios/fora de faixa e drafts inválidos ocultos sem perda do
alerta/bloqueio, persistência após reload e ausência de publicação/device/pairing na
rede. Resultados e capturas estão em [execução](registros/fase-02-execucao.md) e
`registros/evidencias/fase-02/`; não houve alteração de contratos, API ou player.

### Reteste após a segunda rodada independente — 2026-11-07

- [x] Prop canônica atualizada por polling reflete no campo numérico válido.
- [x] Excluir aniversário descarta apenas errors vinculados ao ID excluído e permite salvar.
- [x] Toggle de Recados preserva draft inválido, erro local/global e bloqueio; corrigir depois permite salvar o valor novo.
- [x] Ajuda do seletor Preencher/Conter associada por `aria-describedby` explica corte, imagem inteira e áreas de fundo.
- Evidências em `registros/evidencias/fase-02/phase02-numeric-lifecycle-fix-20261107.json` e capturas `phase02-20261107-10` a `-14`.
- Revalidação independente concluída pelo Sol em 2026-11-07; detalhes e veredito ao fim do registro de revisão.

## Revisão do Sol-6.1

Checklist preenchido pelo revisor após conferir o diff, as evidências e executar
roteiro independente; ver registro de revisão para escopo e limitações.

- [x] Conferir contratos, limites e configuração completa de widgets antigos e adicionais.
- [x] Revisar upload parcial, estado `dirty`, polling e atualização assíncrona de fotos.
- [x] Conferir foco após reordenação e nomes acessíveis das ações.
- [x] Validar prévia sem credenciais e sem publicação implícita.
- [x] Conferir imagens autenticadas, fallback e custo de carregar a biblioteca.
- [x] Reproduzir cenários e avaliar evidências, não apenas screenshots de sucesso.

## Entrega e passagem

Registros: `registros/fase-02-execucao.md` e `registros/fase-02-revisao.md`.
A fase 03 depende do veredito **APROVADA**.
