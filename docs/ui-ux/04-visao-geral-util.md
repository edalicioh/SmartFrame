# Fase 04 — Visão geral baseada no uso real

- Executor: **Luna-6**.
- Revisor: **Sol-6.1**.
- Dependência: fase 03 aprovada.
- Situação: **planejada**.

## Objetivo

Transformar a página inicial em um ponto de entrada operacional: mostrar os
dispositivos existentes, os painéis e o próximo passo relevante para cada situação.

## Leitura e arquivos

- `apps/web/src/app/page.tsx`.
- `apps/web/src/app/globals.css` e componentes `brand.tsx` e `sign-out.tsx`.
- `apps/web/src/app/layouts/page.tsx` e seleção de painel/dispositivo no editor.
- `apps/web/src/app/api/panels/route.ts` e `api/devices/route.ts` (consulta).
- `apps/web/src/lib/session.ts` e `panel-access.ts` (consulta).
- `packages/database/prisma/` (somente consulta do modelo existente).
- `tests/multiple-panels.test.ts` e `tests/auth.test.ts`.

Componentes de dashboard só devem ser extraídos quando tiverem uma responsabilidade
concreta. Helper compartilhado de estados criado na fase 03 pode ser reutilizado.

## Tarefas do Luna-6

### 04.1 — Substituir apresentação fixa por dados reais

- [ ] Manter autenticação e filtro obrigatório por `householdId` em todas as consultas.
- [ ] Listar dispositivos não revogados com nome e última comunicação, quando conhecida.
- [ ] Exibir nome do painel enviado e estado de confirmação usando os mesmos critérios
      da fase 03, sem apresentar última comunicação como garantia de conexão atual.
- [ ] Exibir ausência de painel enviado como situação legítima e com próximo passo.
- [ ] Buscar somente campos utilizados, com ordenação e limite de listagem explícitos.
- [ ] Não buscar todos os rascunhos completos nem fazer consulta por cartão em loop.
- [ ] Se houver mais registros que o limite, distinguir total e itens exibidos.

A implementação pode consultar o banco pelo Server Component já existente. Não criar
API pública ou migration só para construir cartões do dashboard.

### 04.2 — Corrigir métricas e terminologia

- [ ] Trocar “Layouts” por **Painéis**, contando apenas os layouts online elegíveis
      pelos mesmos critérios da listagem atual: chaves `panel:` ou `online:` da família.
- [ ] Não contar layouts legados de outro tipo como painéis editáveis atuais.
- [ ] Manter contagem de fotos com descrição fiel: biblioteca total não é necessariamente
      quantidade pronta para publicar.
- [ ] Remover o destaque de álbuns se não houver fluxo utilizável, sem excluir dados
      ou fingir que uma tela de álbuns existe.
- [ ] Preferir poucas métricas úteis a preencher o layout com indicadores sem ação.
- [ ] Padronizar “painel”, “rascunho”, “publicação” e “dispositivo” entre as páginas.

### 04.3 — Orientação inicial condicionada aos dados

- [ ] Sem painéis: orientar criar o primeiro painel.
- [ ] Sem fotos: orientar adicionar fotos, sem tornar isso obrigatório para painéis sem fotos.
- [ ] Sem dispositivos: orientar vincular tablet, deixando claro que edição já é possível.
- [ ] Com painéis/dispositivos existentes: priorizar gerenciamento, não repetir tutorial vazio.
- [ ] Seções Biblioteca e Dispositivos da navegação devem apontar para conteúdo útil,
      não apenas um banner sem lista ou ação correspondente.
- [ ] Remover roadmap de desenvolvimento da área principal; não inventar funcionalidades
      futuras como se estivessem disponíveis.
- [ ] Reduzir destaque de versão, stack e termos de implementação sem remover informações
      operacionais úteis, como indicação de acesso local sem login.

### 04.4 — Atalhos contextuais seguros

- [ ] Cartões de painel/dispositivo oferecem **Personalizar** com contexto apropriado.
- [ ] Permitir contexto via parâmetros `panelId` e/ou `deviceId` em `/layouts`, se
      necessário para os atalhos; ler pela API de roteamento suportada pelo Next instalado.
- [ ] IDs recebidos são apenas seleção, nunca autorização. Validar contra as listas
      autenticadas carregadas e manter as verificações do servidor.
- [ ] ID inválido/sem acesso apresenta fallback seguro, sem exibir dados de outra família.
- [ ] Aplicar seleção inicial uma vez; o parâmetro não pode resetar escolhas a cada polling.
- [ ] A URL jamais pode causar publicação ou disponibilização automática.
- [ ] A navegação móvel continua oferecendo acesso ao conteúdo e à conta.

## Critérios de aceite

1. Dispositivos reais substituem o conteúdo vazio fixo quando há registros.
2. A tela vazia só aparece quando os dados correspondentes realmente estão ausentes.
3. Métrica de painéis corresponde aos itens editáveis atuais, sem incluir legado indevido.
4. Um usuário novo entende como criar painel, adicionar fotos e vincular tablet.
5. Um usuário recorrente chega ao contexto correto de edição sem publicar por engano.
6. Dados e atalhos respeitam família, revogação e autenticação.
7. Não há dependência de novo endpoint, migração ou alteração do APK.

## Testes e cenários

```powershell
npm run lint
npm run typecheck
npm test
```

Adicionar testes de helpers de filtro/mapeamento caso extraídos, incluindo layouts
legados, dispositivo revogado, ausência de painel e contexto inválido. Não mascarar
uma consulta incorreta com um filtro apenas no cliente.

Validar no navegador: instalação vazia; painel sem fotos; fotos sem dispositivo;
um e vários dispositivos; painel enviado sem confirmação; confirmação recebida;
nome longo; ID inexistente na URL; ID de outra família; modo autenticado e modo
local, usando configurações de desenvolvimento separadas e autorizadas.

Verificar desktop e 390 px, incluindo navegação, atalhos, foco e retorno ao início.
Não criar contas, dispositivos ou publicações na instalação real para produzir evidência.

## Revisão do Sol-6.1

- [ ] Conferir queries reais: filtros por família, elegibilidade de painel e revogação.
- [ ] Verificar totais versus listagem limitada e ausência de consultas N+1.
- [ ] Conferir rótulos e estado de confirmação contra as regras da fase 03.
- [ ] Testar parâmetros ausentes, inválidos e sem acesso, sem publicação automática.
- [ ] Verificar ausência de promessas sobre álbuns, offline e funcionalidades futuras.
- [ ] Reproduzir os estados vazio e preenchido, não revisar somente o cenário novo.

## Entrega e passagem

Registros: `registros/fase-04-execucao.md` e `registros/fase-04-revisao.md`.
A fase 05 depende do veredito **APROVADA**.
