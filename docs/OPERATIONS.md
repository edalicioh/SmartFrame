# Operação e limites atuais

## Persistência

- Desenvolvimento: `.data/smartframe.db` e `.data/media`, relativos à raiz do projeto.
- Docker: volume `smartframe_data` em `/app/.data`.
- Prisma usa o adaptador better-sqlite3, WAL e timeout de 5 segundos para bloqueios.
- A aplicação não suporta banco remoto, parâmetros URI SQLite ou múltiplas máquinas gravando no mesmo arquivo.
- Os processos web e worker devem acessar o mesmo volume local. SQLite sobre sistemas de arquivos de rede não está homologado.

## Worker

- Fila persistida no SQLite com reserva atômica por atualização condicional.
- Lease inicial de 60 segundos, renovada a cada 20 segundos durante o processamento, e até três tentativas.
- Handlers: `maintenance.sessions`, `background.optimize` e `widgets.refresh` (clima/cotações).
- Uma manutenção é agendada por hora; a consulta normal da fila ocorre a cada 5 segundos.
- O processamento é pelo menos uma vez: handlers precisam ser idempotentes, mesmo com renovação da lease.
- O processamento de fotos usa Sharp, com limite de entrada de 12 MB/24 MP e saída de até 1600 × 1600/4 MB. O original é descartado após sucesso; falhas mantêm o arquivo privado para retentativas.

## Segurança

- Mantenha `.env`, bancos, backups e futuras chaves de assinatura fora do controle de versão.
- Nenhuma senha padrão é fornecida.
- Não exponha a porta interna do Next.js no Docker; o proxy sobrescreve cabeçalhos de IP recebidos do cliente.
- A limitação interna do Better Auth usa memória de uma instância; reiniciar o web zera essa contagem. O Compose inclui uma segunda limitação no Nginx.
- Não executar várias réplicas do servidor sem revisar limitação de tentativas e a estratégia do SQLite.
- Não há envio de e-mail ou recuperação de senha implementados.
- O modelo atual atende um proprietário por conta. Colaboradores e permissões granulares virão em etapa posterior.
- O modo local explícito pode abrir o painel sem login; não o exponha publicamente. Veja [a configuração](LOCAL-ACCESS.md).
- Auditoria: configuração inicial, emissão/resgate de código, revogação, rascunho e publicação. Cobertura de login e dos módulos futuros será ampliada posteriormente.
- O pareamento limita dez tentativas por chave de IP em cinco minutos, com teto global de cem por janela. Em produção, o proxy precisa sobrescrever o IP recebido do cliente; o Compose já faz isso.

## Dependências de desenvolvimento

- ESLint 9 está fixado por compatibilidade com os plugins incluídos em `eslint-config-next`. O npm emite um aviso de descontinuação dessa versão; migrar para ESLint 10 quando o conjunto de plugins declarar suporte, sem ignorar conflitos de peer dependencies.
- A instalação usa lockfile. Não há vulnerabilidades conhecidas na auditoria npm realizada na entrega; repetir `npm audit` ao atualizar dependências.

## Backup inicial

Ainda não há rotina automatizada. Para um backup consistente nesta fundação:

1. Interrompa web e worker, impedindo novas gravações.
2. Copie a pasta/volume de dados completo, incluindo arquivos auxiliares do SQLite se presentes; não copie somente o `.db` enquanto processos estiverem gravando.
3. Proteja também o `.env` de forma separada e segura.
4. Restaure uma cópia em um ambiente isolado antes de considerar o backup verificado.
5. Reinicie os serviços originais após a cópia.

No Docker, mantenha o volume; não use `down -v`. Um procedimento automatizado de backup e restauração testado é requisito de conclusão da V1, não uma entrega já disponível.

## Pendências de validação

- Assinatura Android de release e desempenho prolongado no PRITOM. O protótipo de debug já foi compilado e executado no dispositivo de 32 bits; veja [a validação inicial](ANDROID-VALIDATION.md).
- Estabilidade de 72 horas e cache de carrossel com várias fotos. A foto única já usa cache local, hash e gravação atômica; veja [a personalização](PERSONALIZATION.md).
- TLS de produção, restauração automatizada e expansão da auditoria.
- Editor visual, agendamentos e integrações.
