# Personalização — fluxo online v0.4

O fluxo principal é o editor de painéis em `/layouts`. Crie ou selecione um painel,
ajuste suas configurações e salve. Para exibi-lo, selecione um tablet e clique em
**Exibir neste dispositivo**. Salvar não altera o que está na tela; a mesma foto pode
ser usada em mais de um painel. Para excluir um painel em uso, primeiro escolha e
exiba outro painel em cada dispositivo que o utiliza. O editor mantém rascunho e publicação como
revisões distintas; `appliedRevision` só deve refletir a revisão online depois que o
APK confirmar aplicação bem-sucedida. Contrato de campos e endpoints: [API](API.md).

## Atualizar instalação existente

1. Faça backup consistente de `.data` (banco SQLite, mídias e arquivos auxiliares) e
   preserve `.env` separadamente. Restauração de cópia deve ser verificada antes de
   qualquer atualização. Não use `docker compose down -v`.
2. Preserve os registros de dispositivos/credenciais existentes; não exclua banco,
   mídia, conta ou pareamento para migrar. A atualização normal não exige pareamento
   novo. Para múltiplos painéis, pare os processos que usam o SQLite e execute
   `npm run db:migrate` depois do backup. A migration preserva rascunhos e versões
   publicadas e associa os layouts online existentes aos seus dispositivos.
3. Instale o APK v0.4 somente se sua assinatura for compatível com o APK instalado.
   Não desinstale automaticamente: isso pode apagar dados e credenciais locais.
4. No editor, escolha cada dispositivo, crie/ajuste a configuração, selecione fotos
   da biblioteca e publique intencionalmente. Não há promessa de conversão automática
   do conteúdo offline v0.3 em layout online.
5. Confirme no painel que a publicação foi aplicada pelo APK. O APK v0.4 carrega
   somente o player online: sem rede/servidor, a tela não tem fallback offline
   garantido. Faça validação real no tablet antes de considerar a atualização aceita.

## Acesso e segurança

O administrador usa a sessão configurada para a instalação. Pareamento continua
identificando o dispositivo e guardando sua credencial com segurança nativa. O ID em
uma URL não autoriza APIs Bearer; abrir a página em browser comum não concede acesso.
Não copie token para query string, JavaScript, logs ou armazenamento web.

Em produção, use HTTPS e certificado confiável alcançável pelo tablet. Para debug
USB, `http://localhost:3000` aponta para o próprio tablet até configurar `adb reverse`
(`adb -s SERIAL reverse tcp:3000 tcp:3000`); mantenha USB conectado. Para acesso em
LAN use hostname/IP do servidor e HTTPS, não localhost nem HTTP exposto. Tela cheia
imersiva não é modo Android lock-task/kiosk.

O upload pela biblioteca é processado pelo servidor com Sharp, ajustado para caber
em 1024×600 preservando proporção. A escolha e a publicação são explícitas. Os
endpoints novos e limites estão descritos em [API](API.md); confirme-os na versão
implantada e mantenha backups antes de alterações operacionais.

## Galeria de templates e grade livre modular

Em **Aparência e layout**, além do modo clássico **Painel dividido**, agora é possível:

- Aplicar um dos **6 templates prontos** (_Porta-Retrato Clássico_, _Painel Familiar da Casa_, _Mesa de Foco & Pomodoro_, _Cotações & Agenda Executiva_, _Galeria Minimalista_ e _Painel Contínuo Sem Bordas_), preservando `photoIds`, eventos de calendário, recados, tarefas e demais dados cadastrados.
- Alternar para **Grade livre modular (arrastar e redimensionar)** (`gridLayout.enabled = true`), posicionando e redimensionando os widgets ativos em grades **24×24 (paisagem)** e **12×40 (retrato)** com detecção de colisões, tamanhos mínimos por catálogo, inspetor numérico acessível (`X`, `Y`, `W`, `H`) e botão **Organizar automaticamente sem colisões**.

## Fundo, aparência e tamanho dos widgets

Em **Aparência e layout → Estilo e superfície do painel** e **Fundo e tamanho dos widgets**,
escolha presets visuais (_Original_, _Cartões arredondados_, _Superfícies planas_,
_Somente conteúdo_ e _Painel contínuo_), ajuste cantos, espaçamentos, bordas, sombras e
cores por cartão com herança do painel para cada widget (veja [Aparência em camadas](APPEARANCE.md)
e o [Roadmap PhoneBox](PHONEBOX-ROADMAP.md)). Use **Usar fundo padrão** para voltar a acompanhar o
tema e **Redefinir para aparência herdada** para limpar sobrescritas individuais. O tamanho
pequeno, normal ou grande altera o espaço vertical relativo de relógio, clima, cotações e
calendário; o espaço é compartilhado entre os cartões ativos. O tamanho dos números
do relógio é independente. A largura das fotos continua sendo ajustada na opção de
layout existente. O fundo das fotos aparece quando a imagem não cobre a área; no modo
conter, a cópia desfocada pode cobri-lo (exceto no preset _Superfícies planas_). Para cores
personalizadas, o texto dos cartões usa contraste automático, exceto se a cor dos números do
relógio for definida à parte.

## Registro histórico do modo Foto v0.3

Os passos de upload, cache local, publicação offline e verificações abaixo pertencem
à versão anterior; não descrevem o comportamento do APK v0.4. Foram registrados em
30/10/2026: pareamento, foto publicada, relógio e confirmação de revisão no PRITOM,
além de reabertura offline do APK antigo. A amostra de publicação levou cerca de
18,5 segundos. Esses fatos históricos não validam o fluxo v0.4.

Houve uma verificação básica da v0.4 no aparelho: instalação por atualização,
abertura, diálogo de conexão e tela cheia. O teste do dashboard pareado e da
estabilidade de 72 horas segue pendente, assim como build de distribuição assinado
e outros modelos. Consulte o [registro de validação](ANDROID-VALIDATION.md).
