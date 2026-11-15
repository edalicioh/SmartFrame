# Fase 01 — Organização do editor e base visual

- Executor: **Luna-6**.
- Revisor: **Sol-6.1**.
- Dependência: leitura do [plano geral](README.md).
- Situação: **APROVADA após correções e reavaliação do Sol-6.1**. Andamento das fases posteriores no [plano geral](README.md).

## Objetivo

Transformar a página extensa de personalização em uma área de trabalho organizada,
mantendo todas as operações existentes e estabelecendo uma base visual consistente.

## Leitura obrigatória

- `apps/web/AGENTS.md` e guias relevantes do Next instalado.
- `apps/web/src/app/layouts/page.tsx`.
- `apps/web/src/components/online-frame-editor.tsx`.
- `apps/web/src/components/local-widget-editor.tsx`.
- `apps/web/src/app/globals.css` e `apps/web/src/app/editor.css`.
- `docs/PERSONALIZATION.md`.

## Escopo e arquivos

| Arquivo                                           | Intervenção prevista                                            |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `apps/web/src/components/online-frame-editor.tsx` | Organizar composição e navegação, preservando estado e handlers |
| `apps/web/src/components/online-editor/` (novo)   | Componentes concretos para cabeçalho, seções e feedback         |
| `apps/web/src/app/editor.css`                     | Estilos do editor online com escopo próprio                     |
| `apps/web/src/app/globals.css`                    | Tokens compartilhados estritamente necessários                  |
| `apps/web/src/app/layouts/page.tsx`               | Ajustes de composição e retorno ao início, se necessários       |

Não refatorar `frame-editor.tsx`, que não é o editor renderizado por `/layouts`, só
por semelhança de nome. Preservar seletores de telas legadas até verificar seu uso.

## Tarefas do Luna-6

### 01.1 — Registrar a linha de base

- [x] Conferir diff inicial e ambiente de desenvolvimento.
- [x] Abrir `/` e `/layouts` em 1440×1000 e 390×844 no Chromium headless; resultados/screenshot em `registros/fase-01-execucao.md`.
- [ ] Registrar baseline visual anterior à implementação (não realizado; limitação histórica). Screenshots preenchidos e preservação dos controles foram conferidos na reavaliação.
- [x] Executar lint, typecheck e testes existentes; resultados registrados neste relatório.
- [x] Usar fixture de desenvolvimento temporária; não parear nem publicar em tablet real.

### 01.2 — Definir a hierarquia da tela

- [x] Cabeçalho com painel em edição, estado do rascunho e ações principais visíveis (inspeção e browser).
- [x] Navegação de edição com três seções: **Fotos**, **Widgets** e **Aparência** (inspeção e browser).
- [x] Dispositivos, permissões e pareamento em área secundária identificada, acessível
      sem obrigar o usuário a sair do rascunho.
- [x] Duplicar, renomear e excluir agrupados em um menu de ações secundárias (inspeção e teclado Space/Tab em browser).
- [x] Nenhum dispositivo selecionado não impede criar, editar ou salvar painel (confirmado em browser; publicação não acionada).

Usar botões com `aria-pressed` para a seleção simples de seções, ou implementar o
padrão completo de tabs com navegação de teclado. Não adicionar `role="tab"` sem
comportamento correspondente. O menu pode ser uma expansão simples com botões
nativos; não simular `role="menu"` incompleto.

### 01.3 — Refatorar sem alterar as regras de dados

- [x] Manter `config`, `dirty`, seleção e operações em uma fonte de verdade (inspeção estática).
- [x] Extrair apresentação de navegação e feedback por responsabilidade, com props tipadas e sem `any`.
- [x] Trocar de seção não pode resetar campos, seleção de fotos ou estado de edição (browser: campo, seleção e preview mantidos).
- [x] Preservar aviso ao fechar/recarregar e confirmação ao trocar painel com alterações (beforeunload e confirmação de troca observados no browser).
- [x] Preservar bloqueios contra cliques duplicados e respostas assíncronas obsoletas (guards e seleção reconferidos por diff).
- [x] Não disparar chamadas adicionais por remontar seções sem necessidade (árvore preservada, effects sem dependência da navegação e iframe mantido no browser).

### 01.4 — Unificar a linguagem visual

- [x] Reaproveitar a família de cores verde da administração (inspeção e browser).
- [x] Definir variantes primária, secundária, discreta e destrutiva de botões (inspeção; cores computadas no browser).
- [x] Diferenciar informação, sucesso, atenção e erro com texto, não só cor.
- [ ] Consolidar refinamentos cosméticos de espaços com base em 4/8 px (acabamento não bloqueante; ver R06 da revisão).
- [x] Não alterar as cores configuradas pelo usuário para o conteúdo do player (diff e preview conferidos).
- [x] Evitar seletores genéricos que afetem todos os botões ou todas as páginas (novas regras limitadas a classes do editor).

### 01.5 — Preparar feedback e estados vazios

- [x] Separar carregamento inicial de ausência real de dados para painéis, dispositivos e fotos, com erro e retentativa.
- [x] Criar mensagens para nenhum painel, nenhum dispositivo e erro de carregamento.
- [x] Estados vazios explicam o próximo passo com ação disponível (inspeção e navegador: respostas vazias controladas após erro/retentativa).
- [x] Mensagens de sucesso usam uma região de status persistente e única (`role=status`, `aria-live=polite`).
- [x] Não remover os avisos existentes enquanto os novos não cobrirem os mesmos casos (diff de feedback e fluxos de proteção conferidos).

## Critérios de aceite

1. O usuário identifica qual painel está editando e onde acessar cada grupo de opções.
2. Todos os controles originais permanecem alcançáveis, inclusive widgets adicionais.
3. Trocar entre Fotos, Widgets e Aparência preserva o rascunho e a prévia.
4. Criar e salvar funcionam sem dispositivo; publicação continua exigindo destino.
5. Menu secundário e navegação funcionam por teclado, com foco visível.
6. Em 390 px e 1440 px não há overflow horizontal da página nem ações inacessíveis.
7. Não há alteração de payloads, endpoints, autenticação, schema ou player.

## Verificação

Executar separadamente, da raiz:

```powershell
npm run lint
npm run typecheck
npm test
```

Validação de navegador: criar painel, editar um campo, trocar as três seções,
retornar ao campo e confirmar que o valor permanece; cancelar troca de painel com
alterações; abrir e fechar o menu pelo teclado. Registrar viewport e resultado.

Não considerar testes Node existentes como prova de comportamento de foco ou layout.

## Revisão do Sol-6.1

- [x] Conferir preservação integral dos controles e das regras de bloqueio por diff; fluxos obrigatórios reproduzidos no Chromium.
- [x] Procurar estado duplicado, effects remontados, closures obsoletas e CSS vazando por inspeção estática.
- [x] Conferir identidade verde apenas na administração, sem modificar tema do painel; R01 resolvido e contraste reconferido.
- [x] Reproduzir troca de seção e proteção de rascunho no navegador (roteiro independente do Sol-6.1).
- [x] Verificar critérios de aceite, comandos e evidências da execução; reavaliação APROVADA em `registros/fase-01-revisao.md`.

## Entrega e passagem

Luna-6 registra a execução em `registros/fase-01-execucao.md`; Sol-6.1 registra a
revisão em `registros/fase-01-revisao.md`, seguindo o protocolo do plano geral.
Somente revisão **APROVADA** libera a fase 02.
