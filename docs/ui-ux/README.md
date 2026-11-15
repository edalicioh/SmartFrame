# Plano de evolução UI/UX — SmartFrame

## Objetivo e situação

Planejar a melhoria da interface web, com prioridade para o editor de painéis em
`/layouts`, preservando dados, autenticação, publicações e compatibilidade com o tablet.

- Executor de todas as fases: **Luna-6**.
- Revisor de todas as fases: **Sol-6.1**.
- Situação atual: **fases 01 e 02 APROVADAS após correções e revisão; fase 03 não iniciada, aguardando comando do usuário**.
- Estes arquivos são instruções de execução, não evidências de entrega.
- Os nomes dos modelos são os informados pelo usuário, não IDs de provedores
  validados. Antes de executar em uma ferramenta, resolver o modelo disponível;
  não inventar identificadores ou substituir silenciosamente o responsável.

## Sequência obrigatória

| Fase                                                  | Entrega                                           | Dependência      | Executor | Revisor | Situação  |
| ----------------------------------------------------- | ------------------------------------------------- | ---------------- | -------- | ------- | --------- |
| [01](01-organizacao-e-base-visual.md)                 | Organização do editor e base visual               | Nenhuma          | Luna-6   | Sol-6.1 | Aprovada |
| [02](02-fotos-widgets-e-previa.md)                    | Fotos, widgets, aparência e prévia                | Fase 01 aprovada | Luna-6   | Sol-6.1 | Aprovada |
| [03](03-publicacao-e-dispositivos.md)                 | Publicação segura e dispositivos                  | Fase 02 aprovada | Luna-6   | Sol-6.1 | Planejada |
| [04](04-visao-geral-util.md)                          | Visão geral baseada em dados reais                | Fase 03 aprovada | Luna-6   | Sol-6.1 | Planejada |
| [05](05-responsividade-acessibilidade-e-validacao.md) | Acabamento responsivo, acessibilidade e regressão | Fase 04 aprovada | Luna-6   | Sol-6.1 | Planejada |

Acessibilidade, responsividade e testes começam na fase 01. A fase 05 consolida e
audita o resultado; não autoriza adiar problemas conhecidos das fases anteriores.

## Base observada no repositório

- `apps/web/src/app/layouts/page.tsx` renderiza `OnlineFrameEditor`.
- `apps/web/src/components/online-frame-editor.tsx` concentra edição, painéis,
  publicação, pareamento, permissões e prévia.
- `apps/web/src/components/local-widget-editor.tsx` inclui recados, contagem
  regressiva, aniversários, tarefas e pomodoro. Eles devem continuar disponíveis.
- `apps/web/src/app/globals.css` define a identidade verde da aplicação; o editor
  online em `editor.css` usa vários valores azuis independentes.
- A página inicial tem contagens reais, mas seu bloco de dispositivos exibe conteúdo
  fixo de apresentação mesmo quando existem dispositivos cadastrados.
- A publicação usa `expectedRevision` e separa ativação de disponibilização.
- Os testes atuais usam Vitest em Node e testes próprios do player. Não foi
  identificada infraestrutura Playwright nem uma suíte DOM de componentes.

Essas observações são de leitura de código. Não houve auditoria visual no navegador
nem execução de testes para produzir este planejamento.

## Limites de escopo

1. Manter a identidade verde; não criar marca nova ou tema escuro da administração.
2. Reutilizar React, CSS e `lucide-react`; não adicionar um framework visual.
3. Não alterar contratos públicos, persistência, migrações, autenticação ou APK.
4. Não modificar o player para simular uma prévia diferente do conteúdo publicado.
5. Não adicionar autosave, exclusão de fotos da biblioteca, drag-and-drop obrigatório,
   novas integrações ou funcionamento offline.
6. Não efetuar deploy, instalar APK, publicar em tablets reais, criar commits ou
   manipular dados reais sem autorização específica do usuário.
7. Novos arquivos de componentes e helpers citados nos planos são **propostos**;
   confirmar a estrutura antes de criá-los. Não manter abstrações vazias.

Se uma entrega exigir sair desses limites, interromper a parte afetada e apresentar
ao usuário a mudança de escopo antes de implementá-la.

## Regras técnicas para o executor

- Ler `apps/web/AGENTS.md` e os guias relevantes da versão instalada em
  `node_modules/next/dist/docs/`, resolvendo a localização do pacote quando necessário.
- Conferir `git status --short` antes de começar; preservar trabalho alheio.
- Usar Node `>=24 <25` e npm `>=11`, conforme `package.json`.
- Ler o plano completo da fase e a revisão aprovada da fase anterior.
- Extrair componentes por responsabilidade, mantendo uma fonte de verdade para o
  rascunho e para o estado das operações.
- Preservar `expectedRevision`, bloqueios de operação, polling com cleanup e aviso
  de alterações não salvas. Não corrigir conflitos sobrescrevendo dados.
- Não enviar credenciais de dispositivo à prévia, logs, screenshots ou URLs.
- Não usar `npm run format` indiscriminadamente: ele formata o repositório inteiro.
- Registrar resultados reais: comando executado, resultado, ambiente e limitações.

## Estratégia de testes

### Verificação automatizada existente

Executar da raiz, conforme o escopo de cada fase:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:player
```

`npm run check` agrega esses quatro comandos. Na fase final, executar também
`npm run build`, após conferir as variáveis e requisitos locais. O build executa
sincronização do player e geração do Prisma; verificar o diff depois.

A suíte Vitest configura banco SQLite e armazenamento de testes isolados em `.data`
e aplica migrações nesse banco via `tests/global-setup.ts`. Não substituir isso pelo
banco da instalação nem executar `db:migrate` no banco real como parte do redesenho.

### Cobertura nova sem presumir ferramentas inexistentes

- Usar Vitest para helpers puros de UI: estados derivados de publicação, seleção,
  reordenação e mapeamento de mensagens, quando esses helpers forem extraídos.
- Não chamar testes de API ou inspeção de strings de “testes de interação React”.
- Validar os fluxos de interface no navegador e registrar passos e resultados.
- Automação DOM/E2E com novas dependências é uma ampliação separada: apresentar
  proposta ao usuário se necessária. Não inventar comandos `test:e2e` existentes.
- Falta de navegador ou tablet deve ser registrada como **não validado**, nunca
  transformada em aprovação visual ou confirmação real de aplicação no APK.

## Ciclo Luna-6 → Sol-6.1

1. Luna-6 executa somente a fase liberada, atualiza os checklists e cria o registro
   correspondente em `docs/ui-ux/registros/fase-NN-execucao.md`.
2. O registro deve conter resumo, arquivos alterados, critérios atendidos,
   testes/comandos com resultados, evidências visuais e limitações.
3. Sol-6.1 lê plano, diff, código afetado e evidências. A revisão é independente;
   não basta repetir a conclusão do executor.
4. Sol-6.1 cria `docs/ui-ux/registros/fase-NN-revisao.md` com achados, severidade,
   localização, impacto, correção esperada e veredito.
5. Luna-6 corrige os achados; Sol-6.1 reavalia. Não avançar automaticamente.

Os registros serão criados durante a execução/revisão; não estão preenchidos neste
planejamento. Não é necessário iniciar sessões ou agentes para criar os planos.

### Severidade e aprovação

| Severidade | Exemplos                                                                          | Efeito                       |
| ---------- | --------------------------------------------------------------------------------- | ---------------------------- |
| Crítica    | Vazamento de credenciais, acesso entre famílias, perda de dados                   | Bloqueia                     |
| Alta       | Publicar no tablet errado, sobrescrever rascunho, fluxo principal quebrado        | Bloqueia                     |
| Média      | Critério de aceite não atendido, controle inacessível, falha responsiva relevante | Bloqueia                     |
| Baixa      | Ajuste cosmético sem impedir uso ou descumprir aceite                             | Registrar; pode não bloquear |

Vereditos: **APROVADA**, **AJUSTES NECESSÁRIOS** ou **BLOQUEADA**. Uma fase só é
aprovada com critérios de aceite atendidos, evidências suficientes e nenhum achado
crítico, alto ou médio aberto. Pendências de validação obrigatória bloqueiam a aprovação.
Limitação externa deve ser explicitada, com solicitação da evidência ao usuário.

## Modelo mínimo dos registros futuros

```markdown
# Fase NN — execução ou revisão

Responsável:
Data:
Referência do diff/commit, quando houver:
Escopo verificado:
Critérios de aceite e evidências:
Comandos executados e resultados:
Validação no navegador: viewport, passos, resultado e evidência
Achados: severidade, arquivo/linha, impacto e ação
Pendências e limitações:
Veredito (somente revisão):
```
