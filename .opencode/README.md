# Agentes e skills do SmartFrame

As definições nesta pasta são descobertas pelo OpenCode no projeto, sem mudar o agente ou modelo padrão da sua instalação.

## Agente principal

Selecione `smartframe` na interface para desenvolver com o contexto do projeto.

## Release e operações

- `smartframe-release-ops`: commits solicitados, deploys explicitamente autorizados e acompanhamento pontual de workflows/serviços.

Push para `main` pode iniciar o deploy de produção. O agente não faz push, deploy, alteração em servidor ou atualização de tablet sem pedido explícito. O acompanhamento é pontual; não há monitoramento contínuo em background.

## Subagentes de revisão

- `smartframe-web-review`: editor, APIs, contratos e isolamento.
- `smartframe-player-review`: dashboard web, Android e rede.
- `smartframe-security-review`: segurança, dados e migrations.

Eles são somente leitura: não editam arquivos nem executam comandos. Peça explicitamente, por exemplo: “Use o subagente smartframe-web-review para revisar minhas alterações no editor”. Peça ao agente principal para executar testes separadamente.

## Distribuição de modelos e custo

- `smartframe`: usa o modelo selecionado na sessão principal.
- `smartframe-web-review`: `opencode/deepseek-v4.1-flash-free`.
- `smartframe-player-review`: `opencode/mimo-v2.6-flash-free`.
- `smartframe-security-review`: herda o modelo da sessão principal, para manter a revisão de segurança no modelo escolhido.

Os modelos gratuitos podem ter limites de uso ou ficar indisponíveis. Eles enviam o contexto necessário para o provedor correspondente; não inclua segredos ou dados reais. Os arquivos dos agentes permitem trocar o campo `model` quando necessário.

## Skills

- `@smartframe-editor`: editor, contratos, publicação e widgets.
- `@smartframe-player-android`: dashboard, Android e conectividade.
- `@smartframe-dados`: SQLite, migrations, worker e preservação de dados.
- `@smartframe-validacao`: escolha e relato de verificações.

Exemplos: “Use @smartframe-editor para adicionar uma opção ao widget” ou “Use @smartframe-validacao para verificar as alterações”. As skills também podem ser carregadas automaticamente quando relevantes.

As instruções gerais estão em `AGENTS.md`; `apps/web/AGENTS.md` continua aplicável ao código web. Revise estas orientações quando arquitetura, scripts ou versões mudarem.
