# Deploy automático em servidor Linux

O workflow `.github/workflows/deploy.yml` executa em pushes para `main` e também
pode ser iniciado manualmente em **Actions → Deploy SmartFrame → Run workflow**.
Ele requer um runner dedicado, identificado pela label `smartframe`. O deploy só
deve ser habilitado depois de configurar o servidor e preparar o volume.

Antes do deploy, um job hospedado pelo GitHub compila e testa o Android. O APK da
mesma revisão é incluído na imagem do servidor; depois do deploy, o painel
**Personalizar** oferece o link **Baixar aplicativo Android**. O arquivo é servido
em `/downloads/smartframe.apk` e pode ser baixado por qualquer cliente que alcance
esse endereço, mesmo sem login. O APK é de debug, não uma versão de produção.

## Assinatura do APK no GitHub Actions

O Android só atualiza uma instalação existente se o APK tiver a mesma assinatura.
O deploy falha antes de alterar o servidor se a chave ou a impressão digital não
estiverem configuradas ou não coincidirem. Não gere uma nova chave para substituir
uma instalação existente; não desinstale o app para forçar a atualização.

1. Identifique e faça backup seguro da chave de debug que assinou o APK instalado.
   No setup portátil deste projeto ela normalmente está em
   `.data/android-toolchain/android-user/debug.keystore`. O arquivo contém uma
   **chave privada**: não o adicione ao Git nem o envie pelo chat.
2. Em **Settings → Secrets and variables → Actions → Secrets**, crie o segredo
   `SMARTFRAME_ANDROID_DEBUG_KEYSTORE_BASE64` com o arquivo inteiro codificado em
   Base64, sem quebras de linha. No PowerShell, após verificar o caminho, é possível
   copiar o valor para a área de transferência com:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path '.data/android-toolchain/android-user/debug.keystore'))) | Set-Clipboard
   ```

   Cole diretamente no campo do segredo e limpe a área de transferência depois.
   Armazenar a chave no GitHub permite que workflows autorizados a utilizem;
   proteja a branch, as permissões e o acesso aos segredos do repositório.

3. Em **Variables**, crie `SMARTFRAME_ANDROID_SIGNER_SHA256` com a impressão digital
   SHA-256 do certificado da chave, em minúsculas e sem `:`. Para a instalação
   atualmente validada neste projeto, é
   `414fc47794fdb798e40443f2127c435e026f0d9a759d3c18e42efb66b222afa3`.
   Confirme essa impressão contra o APK instalado antes de usar outra chave.
4. O workflow utiliza a configuração padrão da chave de debug Android (alias
   `AndroidDebugKey` e senhas padrão do Android). Chaves de produção precisam de
   configuração própria; não substitua o processo de distribuição por este fluxo.

Pull requests não recebem a chave de publicação e geram um APK temporário. A chave
deve ser preservada fora do runner: se for perdida ou trocada, APKs posteriores não
atualizarão instalações já assinadas com ela.

## Atualizar automaticamente o tablet conectado por USB

Depois de um deploy web bem-sucedido, o workflow executa
`scripts/update-tablet-usb.sh` no **host Linux do runner**, não em um container.
Ele atualiza apenas o número de série configurado, verifica se o APK instalado
corresponde ao artefato deste deploy e reabre o SmartFrame. A instalação usa
`adb install -r`, sem desinstalar o app ou limpar seus dados e pareamento.

### Preparação única no servidor e no tablet

1. Instale o ADB no host. Em Debian/Ubuntu, por exemplo:

   ```bash
   sudo apt-get update
   sudo apt-get install adb android-sdk-platform-tools-common
   ```

2. Ative **Depuração USB** no tablet e mantenha o cabo de dados conectado.
   Execute o comando abaixo com **o mesmo usuário Linux que executa o serviço
   do runner**. No tablet, confira e autorize a chave desse computador, marcando
   a opção de permitir sempre quando apropriado:

   ```bash
   adb devices -l
   ```

   O aparelho deve aparecer como `device`, não `unauthorized` ou `offline`.
   Um ADB autorizado como `root` ou outro usuário não comprova que o usuário do
   runner está autorizado. Se aparecer `no permissions`, configure as regras
   udev e permissões USB da distribuição para esse usuário; não execute todo o
   runner como root para contornar isso. Preserve a chave ADB desse usuário.

3. Em **Settings → Secrets and variables → Actions → Variables**, crie
   `SMARTFRAME_TABLET_SERIAL` com o serial USB exibido pelo comando, por exemplo
   `TABLET-123`. Não use IP/porta nem escolha automaticamente o primeiro aparelho.
   A atualização recusa transportes de rede e emuladores.
4. O SmartFrame precisa já estar instalado e pareado nesse tablet. Preserve a
   chave de assinatura configurada na seção anterior. O Android recusa outra
   assinatura e códigos de versão inferiores; o script não força downgrade,
   não desinstala e não tenta apagar dados para resolver essas recusas.

O usuário do runner terá controle ADB sobre esse tablet. Restrinja o acesso ao
servidor e ao repositório; não exponha ADB por TCP/IP. Não é necessário abrir
portas, configurar Device Owner ou confirmar cada instalação no tablet após a
autorização USB inicial, embora políticas de alguns fabricantes possam exigir
permissões adicionais para instalação via USB.

### Falhas e nova tentativa

- Sem serial configurado ou com o tablet desconectado/não autorizado, o workflow
  registra **atualização USB pendente** no resumo e mantém o deploy web.
- Erros de instalação, assinatura, integridade ou abertura do aplicativo fazem
  a etapa falhar de forma visível. O servidor já publicado não é revertido.
- O script não altera a URL salva no aplicativo nem os encaminhamentos USB.
  O tablet precisa continuar alcançando o servidor pelo endereço configurado.
- A verificação final confirma o APK instalado e o processo em execução, não a
  renderização da tela. A confirmação do painel continua no protocolo do player.
- Não há fila automática de reconexão. Depois de reconectar e autorizar o tablet,
  faça outro deploy ou execute manualmente no checkout do runner que contém o
  APK desejado:

  ```bash
  SMARTFRAME_TABLET_SERIAL=TABLET-123 bash scripts/update-tablet-usb.sh
  ```

  Também é possível fornecer um APK já verificado como argumento:

  ```bash
  SMARTFRAME_TABLET_SERIAL=TABLET-123 bash scripts/update-tablet-usb.sh /caminho/smartframe.apk
  ```

Os comandos têm limites de tempo e sempre selecionam o serial explicitamente.
Outros dispositivos conectados não são atualizados. Os testes com ADB simulado
podem ser executados com `bash tests/update-tablet-usb.test.sh` e rodam no job
`checks` antes de permitir a publicação do servidor.

## Segurança e pré-requisitos

- Linux, Git, Docker e Docker Compose; o daemon Docker deve ser local ao runner.
- Configure o runner como serviço usando as instruções geradas em **Settings →
  Actions → Runners → New self-hosted runner**. Escolha Linux e adicione a label
  personalizada `smartframe`. Use um runner dedicado e mantenha-o atualizado.
- O usuário do runner precisa acessar o daemon Docker. Esse acesso equivale a
  privilégios administrativos no servidor: limite quem pode alterar código e
  workflows na `main`, use proteção de branch e não execute pull requests não
  confiáveis nesse runner. Não coloque tokens do runner no repositório.
- O runner precisa baixar dependências e imagens e alcançar o GitHub por HTTPS.
  Ele inicia a conexão; não é necessário expor portas de entrada para o Actions.
- O volume `smartframe_smartframe_data` deve ser exclusivo desta instalação.
  Não mantenha outros containers ou processos acessando seus arquivos SQLite.
- Mantenha espaço suficiente para build e backups, monitore seu crescimento e
  configure retenção segura fora deste workflow. Ele não apaga backups antigos.

## Configurar ambiente fora do checkout

No servidor, com o mesmo usuário que executará o serviço do runner, prepare os
diretórios (ajuste usuário e grupo se executar como outro usuário):

```bash
sudo install -d -m 0700 -o "$USER" -g "$(id -gn)" /etc/smartframe
sudo install -d -m 0700 -o "$USER" -g "$(id -gn)" /var/backups/smartframe
```

Crie `/etc/smartframe/deploy.env` com permissão `0600`, usando `.env.example`
como referência. Defina um `BETTER_AUTH_SECRET` seguro de pelo menos 32
caracteres e uma `BETTER_AUTH_URL` correspondente à origem real do painel.
Defina `SMARTFRAME_ADMIN_LOGIN=required` para qualquer acesso remoto. O padrão
do Compose publica `127.0.0.1:8080`; acesso remoto exige uma configuração de
rede apropriada e HTTPS confiável. O proxy e os certificados não são criados
pelo workflow. O Android de produção também precisa alcançar um endereço e
certificado confiáveis; `localhost` no tablet não é o PC servidor.

Não defina as variáveis de configuração do SmartFrame no ambiente do serviço do
runner: o Compose daria a elas precedência sobre o arquivo. O script de deploy
recusa as variáveis relevantes herdadas em vez de selecionar valores inesperados.
Nunca registre o segredo nos logs nem o armazene no checkout ou no GitHub.

## Preparar os dados antes do primeiro deploy

O deploy não importa dados e se recusa a executar se o volume
`smartframe_smartframe_data` não existir. Para uma instalação nova, crie-o
explicitamente com `docker volume create smartframe_smartframe_data`. O banco
novo não contém os dados da instalação anterior.

Para **migrar a instalação atual**, faça isso separadamente e antes de ativar o
runner:

1. Pare o servidor, worker e quaisquer outros processos que usem o SQLite de
   origem. Verifique que todos realmente pararam. Não copie o banco em uso.
2. Faça e verifique uma cópia consistente de `.data/smartframe.db`, dos arquivos
   `smartframe.db-wal` e `smartframe.db-shm` se existirem, de `.data/media` e de
   quaisquer dados usados em `.data/player-online`. Guarde também o `.env` de
   origem de forma segura e separada. Esses dados podem conter informações
   privadas; use transporte autenticado e restrinja o acesso aos backups.
3. No servidor Linux, crie ou identifique o volume de destino. **Não extraia uma
   cópia sobre um volume que já contenha dados.** Se ele já estiver em uso,
   primeiro faça backup e confirme um procedimento de restauração.
4. Importe a cópia para a raiz do volume, preservando a estrutura
   `smartframe.db` e `media/`; ajuste a propriedade para o usuário `node` da
   imagem (UID/GID 1000) e verifique o resultado. Mantenha a instalação de
   origem e o backup intactos até validar a migração.
5. Preserve o segredo de autenticação quando apropriado, mas ajuste a URL e o
   modo de login para o novo servidor. Não copie um `.env` sem revisá-lo.
   Valide conta, painéis, fotos, conexão e pareamento no novo servidor.

O procedimento de cópia e importação é deliberadamente manual: o workflow não
pode decidir se deve substituir um banco existente. Não desinstale o APK para
migrar, pois isso pode apagar suas credenciais locais.

### Exemplo de transferência a partir do Windows

Depois de parar e verificar todos os processos que usam o banco no computador de
origem, no PowerShell, dentro da pasta do projeto:

```powershell
if (-not (Test-Path '.data/smartframe.db') -or -not (Test-Path '.data/media')) {
  throw 'Banco ou pasta de mídia não encontrado. Confira a instalação de origem.'
}
$items = @('smartframe.db', 'smartframe.db-wal', 'smartframe.db-shm', 'media', 'player-online') |
  Where-Object { Test-Path (Join-Path '.data' $_) }
$archive = Join-Path $HOME 'smartframe-transfer.tar.gz'
if (Test-Path $archive) { throw 'Arquivo de transferência já existe; escolha outro nome.' }
tar -czf $archive -C .data @items
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar a cópia; não importe o arquivo.' }
tar -tzf $archive
if ($LASTEXITCODE -ne 0) { throw 'Falha ao verificar a cópia.' }
```

Transfira esse arquivo para a pasta pessoal do usuário no servidor com `scp` ou
outro meio autenticado. O arquivo contém dados privados e não inclui o `.env`.
Proteja-o durante o transporte e no servidor. A cópia do `.env`, se necessária,
deve ser feita separadamente e nunca deve ir para o Git.

No Linux, **antes de iniciar o runner ou qualquer serviço que use o volume**,
após confirmar que o arquivo recebido é a cópia confiável criada acima:

```bash
docker volume create smartframe_smartframe_data
docker run --rm --user 0 \
  --mount type=volume,source=smartframe_smartframe_data,target=/data \
  --mount "type=bind,source=$HOME/smartframe-transfer.tar.gz,target=/transfer.tar.gz,readonly" \
  alpine:3.21 sh -eu -c '
    if [ -n "$(ls -A /data)" ]; then
      echo "Volume não está vazio. Importação cancelada." >&2
      exit 1
    fi
    tar -tzf /transfer.tar.gz >/dev/null
    tar -xzf /transfer.tar.gz -C /data
    test -f /data/smartframe.db
    test -d /data/media
    chown -R 1000:1000 /data
  '
```

Esse comando recusa um volume não vazio; não o esvazie para forçar a importação.
Se a extração falhar, o volume pode ficar parcialmente preenchido: investigue e
faça backup antes de decidir como proceder. Não execute a importação em paralelo
com outros processos. Depois de validar o novo ambiente, cuide da retenção e do
descarte seguro do arquivo de transferência.

## Sequência do deploy

O script `scripts/deploy-server.sh` valida a configuração e a existência do
volume, constrói a imagem antes de parar os serviços, para `nginx`, `web` e
`worker`, e cria um arquivo tar.gz restrito em `/var/backups/smartframe`. Ele
verifica se o arquivo pode ser lido, executa migrations, inicia `web` e `worker`,
aguarda o healthcheck e só então inicia o nginx. O backup não inclui o `.env`;
guarde uma cópia segura dele separadamente. A leitura do arquivo de backup não
substitui um teste periódico de restauração.

Falhas de backup ou migration interrompem o processo; os serviços podem ficar
parados. Consulte os logs do job e não tente restaurar um banco sobre outro em
uso. Uma migration aplicada pode não ser compatível com a imagem anterior;
rollback exige avaliar a versão e, quando necessário, restaurar um backup
consistente do banco **e** das mídias. O workflow não tenta rollback automático.

Não rode deploys manuais do Compose em paralelo ao workflow. O grupo de
concorrência impede que dois jobs deste workflow executem ao mesmo tempo, mas
não coordena processos externos. Nunca use `docker compose down -v` se quiser
preservar os dados.
