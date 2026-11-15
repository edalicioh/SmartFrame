# Fase 03 — Publicação segura e dispositivos

- Executor: **Luna-6**.
- Revisor: **Sol-6.1**.
- Dependência: fase 02 aprovada.
- Situação: **planejada**.

## Objetivo

Deixar explícito o que é apenas rascunho, o que foi disponibilizado e qual publicação
foi enviada ou efetivamente confirmada pelo dispositivo, evitando ações no destino errado.

## Leitura e arquivos

- `apps/web/src/components/online-frame-editor.tsx` e componentes das fases anteriores.
- `apps/web/src/app/editor.css`.
- `apps/web/src/app/api/panels/route.ts`, `api/panels/publish/route.ts` e
  `api/devices/panels/route.ts` (consulta; contratos não devem mudar).
- `apps/web/src/app/api/devices/route.ts` e `api/devices/pairing-code/route.ts` (consulta).
- `apps/web/src/lib/active-online-version.ts` (consulta).
- `tests/multiple-panels.test.ts`, `tests/active-online-version.test.ts` e
  `tests/online-player-routes.test.ts`.

Componentes propostos em `apps/web/src/components/online-editor/`: barra de ações,
diálogo de publicação e área de dispositivos. Helpers de estado derivados e testes
podem ser criados em `src/lib/online-editor/` e `tests/online-editor-*.test.ts`.

## Semântica obrigatória

| Ação da UI               | Operação existente                                        | Efeito esperado                                 |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------- |
| Salvar rascunho          | Salvar configuração com `expectedRevision`                | Nenhuma mudança na tela do tablet               |
| Disponibilizar no tablet | Salvar quando necessário e publicar com `activate: false` | Publicação fica selecionável, sem trocar a tela |
| Exibir no tablet         | Salvar quando necessário e publicar com `activate: true`  | Solicitar mudança da publicação exibida         |

As três ações não são sinônimas. Não usar um único feedback “Sincronizado” para
configurações locais, publicações enviadas e aplicações confirmadas.

## Tarefas do Luna-6

### 03.1 — Barra de ações e confirmação do destino

- [ ] Manter **Salvar rascunho** e **Publicar…** visíveis sem percorrer o formulário todo.
- [ ] Publicar abre uma escolha explícita entre disponibilizar e exibir, com nome
      do painel, dispositivo de destino e explicação do efeito.
- [ ] Se não houver dispositivo, explicar e oferecer acesso ao pareamento.
- [ ] Nunca selecionar ou substituir silenciosamente o destino no momento de confirmar.
- [ ] Durante operação, bloquear ações conflitantes e impedir envio duplicado.
- [ ] Cancelar o diálogo não altera rascunho, permissões ou dispositivo.
- [ ] Diálogo tem nome acessível, foco inicial adequado, Escape e devolução de foco;
      preferir `<dialog>` nativo, conferindo compatibilidade e comportamento real.

### 03.2 — Estados de rascunho e publicação

- [ ] Mostrar separadamente “Alterações não salvas” e “Rascunho salvo”.
- [ ] Mostrar “Nenhuma publicação enviada” quando não houver versão ativa no destino.
- [ ] Mostrar “Aguardando confirmação” quando versão ativa enviada e aplicada diferirem.
- [ ] Somente mostrar “Versão enviada confirmada” quando a revisão aplicada corresponder
      à revisão ativa enviada ao dispositivo selecionado.
- [ ] Usar `activePanelId` para distinguir o painel em edição do painel enviado.
- [ ] Se editar outro painel, não associar a confirmação do painel ativo ao rascunho aberto.
- [ ] Uma confirmação não prova que o rascunho atual está publicado: ele pode ter sido
      editado depois. Não afirmar equivalência sem dados que a comprovem.
- [ ] `lastSeenAt` indica última comunicação; não inventar status online em tempo real
      ou prazo garantido de entrega.

Preferir um helper puro com estados explícitos para essas combinações. Datas e IDs
de revisão podem ficar em detalhes; mensagens principais devem ser compreensíveis.

### 03.3 — Falhas, concorrência e proteção de dados

- [ ] Em conflito 409, manter configuração local e explicar a alteração concorrente.
- [ ] Oferecer recarregar somente com confirmação de descarte quando houver mudanças.
- [ ] Se salvar funcionar e publicar falhar, informar que o rascunho foi salvo, mas
      a publicação falhou. Não anunciar publicação concluída.
- [ ] Permitir nova tentativa consciente, sem ativar automaticamente após recuperação da rede.
- [ ] Manter `expectedRevision` e não sobrescrever a versão mais recente à força.
- [ ] Respostas atrasadas não podem atualizar o estado visual de outro painel/dispositivo.
- [ ] Preservar proteção em trocar painel, duplicar, criar, excluir e sair da página.
- [ ] Duplicar usa a última versão salva, conforme API; explicar isso com alterações pendentes.
- [ ] Não permitir que polling substitua alterações locais não salvas.

### 03.4 — Pareamento e gestão de acesso

- [ ] Agrupar gerar código, instruções, expiração e endereço do servidor.
- [ ] Código expirado deve ser identificado; oferecer gerar novo, não prometer renovar o antigo.
- [ ] Não confundir fechar o código na interface com revogá-lo no servidor.
- [ ] Atualizar a lista após pareamento sem perder o painel em edição.
- [ ] Listar painéis disponíveis no destino separadamente do painel enviado para exibição.
- [ ] Remover acesso não equivale a excluir painel nem desativar uma versão ativa.
- [ ] Preservar bloqueio existente para remover acesso ao painel ativo.
- [ ] Desvincular exige confirmação nomeando o dispositivo e explicando o efeito.
- [ ] Excluir painel em uso mostra o impedimento e a orientação retornada pela API.

## Critérios de aceite

1. Cada uma das três ações produz exatamente o efeito descrito na tabela de semântica.
2. Antes de publicar, é possível conferir inequivocamente painel, destino e modo.
3. Trocar de dispositivo muda os estados exibidos para o destino correto.
4. Uma publicação só aparece confirmada quando a revisão aplicada corresponde à enviada;
   o painel em edição não recebe confirmação indevida de outro painel ativo.
5. Falha de publicação após salvar e conflito de revisão têm feedback fiel, sem perda local.
6. Pareamento, permissões, exclusão e desvinculação mantêm regras e autenticação atuais.
7. Nenhuma requisição de publicação ocorre por abrir/fechar diálogo ou escolher uma seção.

## Testes e cenários

```powershell
npm run lint
npm run typecheck
npm test
npm run test:player
```

Adicionar testes dos estados derivados: sem destino; sem versão; pendente; revisão
igual; revisão diferente; outro painel ativo; rascunho modificado após confirmação.
Reutilizar testes existentes para contratos de permissão, concorrência e publicação.

No navegador, usar dois painéis e dois dispositivos de desenvolvimento, verificando
salvar sem destino, disponibilizar sem ativar, ativar, cancelar, conflito entre duas
abas, erro de rede, permissão removida e código expirado. Usar ferramentas de rede
para falhas; não adicionar endpoints de teste à produção.

Confirmação real do APK exige tablet de teste e autorização. Sem isso, registrar
validação de interface/contrato e deixar o teste físico pendente, sem simular sua aprovação.

## Revisão do Sol-6.1

- [ ] Inspecionar payloads, `activate`, `expectedRevision` e identidade do destino capturado.
- [ ] Verificar comparações entre revisões e relação entre painel editado e ativo.
- [ ] Revisar todos os caminhos de erro, inclusive sucesso parcial salvar/publicar.
- [ ] Conferir isolamento entre famílias e ausência de tokens na prévia/logs.
- [ ] Reproduzir confirmação/cancelamento e foco do diálogo.
- [ ] Distinguir evidência automatizada, validação no navegador e teste físico do tablet.

## Entrega e passagem

Registros: `registros/fase-03-execucao.md` e `registros/fase-03-revisao.md`.
A fase 04 depende do veredito **APROVADA** para o escopo web; a necessidade e o
resultado da validação física devem permanecer registrados para o fechamento final.
