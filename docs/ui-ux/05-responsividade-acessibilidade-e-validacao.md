# Fase 05 — Responsividade, acessibilidade e validação final

- Executor: **Luna-6**.
- Revisor: **Sol-6.1**.
- Dependência: fases 01–04 aprovadas.
- Situação: **planejada**.

## Objetivo

Consolidar a qualidade visual e funcional da experiência completa, corrigir problemas
encontrados na integração e documentar exatamente o que foi validado.

## Escopo e arquivos

- `apps/web/src/app/globals.css` e `apps/web/src/app/editor.css`.
- Dashboard, página `/layouts`, componentes e helpers alterados nas fases anteriores.
- Login, erro e não encontrado: verificar regressões causadas por estilos globais,
  sem iniciar um redesenho independente dessas telas.
- Testes novos de UI/helpers e suítes existentes afetadas.
- `docs/PERSONALIZATION.md`: atualizar instruções que mudaram de nome/localização.
- `docs/ui-ux/registros/`: consolidar evidências e pendências reais.

Não usar a fase final para adicionar funcionalidades que não estavam nas fases 01–04.

## Tarefas do Luna-6

### 05.1 — Matriz de tamanhos e orientação

Verificar pelo menos estes viewports CSS:

| Contexto         | Viewport   |
| ---------------- | ---------- |
| Celular estreito | 360 × 800  |
| Celular comum    | 390 × 844  |
| Tablet retrato   | 768 × 1024 |
| Tablet paisagem  | 1024 × 768 |
| Desktop          | 1440 × 900 |

- [ ] Sem rolagem horizontal da página para conteúdo normal, inclusive nomes longos.
- [ ] Barra fixa/sticky não cobre o último campo, mensagens ou controles focados.
- [ ] Prévia não comprime os controles nem domina toda a altura no celular.
- [ ] Teclado virtual e safe areas não tornam salvar/publicar inacessíveis.
- [ ] Orientação de prévia retrato/paisagem preserva proporção e legibilidade possível.
- [ ] Navegação e ações destrutivas continuam disponíveis sem depender de hover.
- [ ] Zoom de 200% preserva conteúdo e funcionalidade; verificar reflow em 320 px.

Se teclado virtual ou navegador físico não estiver disponível, registrar a lacuna;
emulação de viewport não prova esse comportamento no aparelho.

### 05.2 — Acessibilidade prática

- [ ] Todas as ações principais são concluídas só com teclado.
- [ ] Ordem de foco acompanha leitura e layout; não usar `tabindex` positivo.
- [ ] Foco visível em botão, link, select, textarea, input e controles personalizados.
- [ ] Labels associados e nomes acessíveis específicos em botões de ícone.
- [ ] Diálogos respeitam foco, Escape, cancelamento e retorno ao elemento de origem.
- [ ] Mensagens de erro são anunciáveis e relacionadas ao campo quando aplicável.
- [ ] Feedback de sucesso usa região de status; polling não anuncia repetidamente
      conteúdo inalterado nem interrompe a leitura a cada atualização.
- [ ] Texto comum com contraste mínimo de 4,5:1; texto grande 3:1; componentes e
      indicadores visuais essenciais com 3:1 quando aplicável.
- [ ] Estados não dependem apenas de cor; ícones decorativos não criam ruído de leitura.
- [ ] Alvos de toque principais com pelo menos 44 × 44 px como meta do projeto.
- [ ] Respeitar `prefers-reduced-motion`; evitar transições obrigatórias ou efeitos contínuos.
- [ ] Fazer uma leitura manual do fluxo principal com leitor de tela disponível.

Medir contraste na UI administrativa efetiva. Não prometer conformidade WCAG total
nem acessibilidade integral do conteúdo personalizado pelo usuário sem auditoria própria.

### 05.3 — Estados de falha e integração

- [ ] Carregamento inicial não mostra ausência de conteúdo como se fosse definitiva.
- [ ] Timeout/rede indisponível preserva rascunho e oferece recuperação compreensível.
- [ ] Upload parcial, processamento demorado e miniatura quebrada têm tratamento consistente.
- [ ] Conflito entre abas não sobrescreve a edição mais recente.
- [ ] Nome grande, lista vazia, lista extensa e limite de seleção não quebram a página.
- [ ] Trocar painel/dispositivo durante ações bloqueadas não associa respostas ao contexto errado.
- [ ] Estado confirmado no tablet continua separado de rascunho salvo e prévia local.
- [ ] Polling para ao desmontar e não gera multiplicação de chamadas ao navegar entre seções.
- [ ] Verificar console e rede: sem erros novos, endpoints inexistentes ou credenciais expostas.

### 05.4 — Limpeza e manutenção

- [ ] Remover apenas CSS/código comprovadamente substituído pelo trabalho destas fases.
- [ ] Não apagar arquivos legados, dados ou alterações de terceiros sem investigação.
- [ ] Não introduzir dependências de runtime desnecessárias, fontes remotas obrigatórias
      ou bibliotecas inteiras para poucos controles.
- [ ] Manter componentes compreensíveis e helpers realmente cobertos pelos testes.
- [ ] Atualizar documentação de uso sem reescrever registros históricos como se fossem atuais.
- [ ] Conferir diff final e alterações geradas por build/sincronização; não descartar
      automaticamente arquivos desconhecidos.

## Regressão ponta a ponta manual

Executar em instalação de desenvolvimento, sem usar dados reais:

1. Abrir visão geral sem dados e seguir a orientação inicial.
2. Criar painel sem dispositivo e salvar rascunho.
3. Enviar fotos, aguardar processamento, selecionar, retirar e reordenar.
4. Configurar widgets principais e adicionais, aparência, fuso e orientação.
5. Conferir prévia e confirmar que não houve publicação implícita.
6. Recarregar após salvar e confirmar persistência dos valores.
7. Vincular dispositivo de teste, quando houver ambiente autorizado.
8. Disponibilizar sem trocar painel ativo e conferir opções do dispositivo.
9. Exibir painel no destino escolhido e conferir estado de envio.
10. Quando houver tablet de teste autorizado, aguardar confirmação real da revisão.
11. Alternar para outro painel/dispositivo e conferir isolamento dos estados.
12. Exercitar conflito de duas abas, falha de rede e saída com alterações pendentes.
13. Retornar à visão geral e conferir dados e atalhos atualizados.

Passos dependentes de tablet não podem ser marcados como realizados usando apenas
mocks ou respostas simuladas. Se o aparelho estiver indisponível, separar aprovação
web de **validação física pendente**, sem afirmar conclusão integral no hardware.

## Comandos finais

Executar da raiz, registrando resultado e falhas anteriores, se existirem:

```powershell
npm run check
npm run build
```

O build pode exigir configuração local; uma execução bloqueada por ambiente deve ser
registrada como bloqueada, não aprovada. Não executar migração do banco real para
resolver um problema de configuração deste trabalho de UI.

Não adicionar comandos de browser testing inexistentes nem declarar testes DOM/E2E
automatizados se foram feitos apenas testes manuais e de helpers.

## Critérios de aceite final

1. Fluxo principal web executado com evidências, sem perda de dados ou publicação indevida.
2. Matriz de viewports validada sem overflow ou ações ocultas relevantes.
3. Teclado, foco, labels, feedback e contraste verificados conforme checklist.
4. Suíte `check` e build concluídos com sucesso; bloqueios devem ser resolvidos antes
   da aprovação final do escopo web.
5. Nenhum achado crítico, alto ou médio aberto nas cinco fases.
6. Documentação corresponde à interface entregue, sem alegar suporte offline novo.
7. Evidências distinguem teste unitário/API, navegador e confirmação física no APK.

## Revisão final do Sol-6.1

- [ ] Ler revisões anteriores e confirmar que não houve regressão dos pontos corrigidos.
- [ ] Inspecionar diff integrado e escopo, incluindo scripts/lockfile se houver mudanças.
- [ ] Reexecutar testes e reproduzir o fluxo principal; não aprovar só pela descrição do Luna-6.
- [ ] Verificar visualmente os viewports e os estados vazio, preenchido e com erro.
- [ ] Reavaliar perda de rascunho, publicação em destino errado e associação indevida de confirmação.
- [ ] Conferir documentação, evidências reais e pendências de validação física.
- [ ] Emitir conclusão específica: escopo web aprovado/reprovado e situação do teste no tablet.

## Entrega e encerramento

Registros: `registros/fase-05-execucao.md` e `registros/fase-05-revisao.md`.
Atualizar a situação das fases no índice somente com base nas respectivas revisões.
O encerramento não autoriza deploy, commit automático ou instalação em dispositivo real.
