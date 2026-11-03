# SmartFrame

Porta-retratos digital auto-hospedável, com editor administrativo por dispositivo e player Android online.

**Stack aprovada:** Next.js + React + TypeScript, Prisma + SQLite, worker Node.js e aplicativo Kotlin/WebView. Sharp será integrado na etapa de processamento de fotos.

## v0.4 — fluxo online por dispositivo

O fluxo principal previsto para v0.4 é administrar e publicar um dashboard online por dispositivo. O APK é um WebView fino pareado; o servidor fornece configuração e mídia. O renderer offline, cache/download de manifesto e polling legado não são parte do fluxo principal novo. APIs antigas podem continuar disponíveis para compatibilidade, mas não se promete funcionamento offline no v0.4. Os contratos de API novos estão marcados como alvo ainda não verificado em [API](docs/API.md).

As configurações usam `Layout`/`LayoutVersion` no SQLite existente, sem migração de schema prevista. Antes de atualizar, faça backup consistente do banco, mídia e `.env`; não apague dados nem force novo pareamento. Só pare processos se uma migração realmente for necessária. O identificador visível do dispositivo não é uma credencial.

## Histórico — modo Foto com widgets, versão 0.3.0

Já é possível **personalizar uma foto de fundo, relógio, data, cores e mensagem pelo painel e publicar no APK**. Veja [como personalizar](docs/PERSONALIZATION.md).

Há também cartões de **temperatura e moedas**. O ambiente atual está configurado para **acesso local sem login**; veja [os cuidados desse modo](docs/LOCAL-ACCESS.md).

Implementado:

- Monorepo npm com contratos compartilhados e manifesto validado por Zod.
- Next.js com tela de login e painel responsivo em português.
- Better Auth com sessões persistidas, cookies HttpOnly, verificação de origem, limitação de tentativas e cadastro público desabilitado.
- Criação inicial do proprietário por CLI, com senha protegida por scrypt e proteção contra reconfiguração.
- Prisma/SQLite com migrations, WAL e estruturas iniciais de domínio.
- Consulta autenticada de dispositivos, isolada por conta e sem exposição de credenciais.
- Fila persistida com leases e retentativas; worker com manutenção de sessões expiradas.
- Docker Compose com web, worker, migrations, Nginx e volume persistente.
- Editor responsivo do modo Foto com prévia compartilhada com o Android, rascunhos e publicação imutável.
- Upload de uma foto de fundo e processamento no worker com Sharp.
- Pareamento por código temporário, revogação e confirmação da revisão aplicada.
- APK Kotlin/WebView com modo imersivo, sincronização a cada 30 segundos, credencial no Keystore, verificação de hash, persistência local e recuperação.
- Clima por cidade, USD/BRL, EUR/BRL e BTC/USD, com cache, atualização em segundo plano e indicação de dados antigos no modo Foto existente.
- Dashboard online opcional, com carrossel configurado no servidor e clima e cotações reais em cache de 30 minutos.

**Ainda não implementado no modo Foto existente:** álbuns e carrossel offline de múltiplas fotos. Também estão pendentes widgets livres com drag-and-drop, layouts independentes por tablet, integrações e agendamentos. O editor atual oferece um layout Foto por conta; não é o editor livre completo da V1. O painel usa contagens reais.

## Estrutura

```text
apps/
  web/                Painel e API Next.js
  worker/             Processo de tarefas assíncronas
  android/            Protótipo Kotlin/WebView
packages/
  auth/               Better Auth e bootstrap administrativo
  contracts/          Manifesto e validação dos widgets iniciais
  database/           Prisma, schema e migrations
  jobs/               Fila persistida e manutenção
  frames/             Fotos, pareamento, versões e publicação
  player/             HTML/CSS/JS usado na prévia e no APK
  widgets/            Clima, cotações, cidades e snapshots
infra/nginx/          Proxy local
scripts/              Configuração e criação do administrador
tests/                Contratos, autenticação e fila
docs/                 PRD e documentação técnica
smartframe-player/    Novo dashboard online, independente do modo Foto existente
```

O dashboard standalone anterior e o renderer offline histórico não descrevem o fluxo principal v0.4; veja [o README do player](smartframe-player/README.md) para o contrato-alvo.

## Desenvolvimento local

### Ligar no Windows com dois cliques

Abra **`Iniciar SmartFrame.cmd`** na pasta do projeto. Ele inicia o servidor local
e o monitor de conexão USB do P7, sem apagar dados ou substituir o pareamento.
Deixe a janela aberta e o cabo conectado. O painel fica em **http://localhost:3000**.
Se o servidor já estiver ligado, ele é reutilizado, não encerrado. Uma segunda
abertura do iniciador é bloqueada para evitar processos duplicados. Para encerrar,
pressione Ctrl+C; somente os processos criados pelo iniciador são encerrados.

O iniciador exige a configuração inicial e as dependências já instaladas. Se o build
estiver ausente, ele o prepara automaticamente. Não expõe o painel na rede local.

### Preparação e desenvolvimento

Requisitos: **Node.js 24 LTS e npm 11+**. Java e Android SDK são necessários apenas para o aplicativo Android.

Na raiz do projeto:

```sh
npm ci
npm run setup:env
npm run db:generate
npm run db:migrate
```

O comando `setup:env` cria um segredo aleatório e preserva um `.env` existente. Não existe senha padrão nem registro público.

### Criar o primeiro administrador — PowerShell

```powershell
$env:SMARTFRAME_ADMIN_NAME = Read-Host 'Nome'
$env:SMARTFRAME_ADMIN_EMAIL = Read-Host 'E-mail'
$senha = Read-Host 'Senha (mínimo 12 caracteres)' -AsSecureString
$env:SMARTFRAME_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $senha).Password
try {
  npm run admin:create
} finally {
  Remove-Item Env:SMARTFRAME_ADMIN_PASSWORD
  Remove-Variable senha
}
```

### Criar o primeiro administrador — Bash

```bash
read -r -p 'Nome: ' SMARTFRAME_ADMIN_NAME
read -r -p 'E-mail: ' SMARTFRAME_ADMIN_EMAIL
read -r -s -p 'Senha (mínimo 12 caracteres): ' SMARTFRAME_ADMIN_PASSWORD
export SMARTFRAME_ADMIN_NAME SMARTFRAME_ADMIN_EMAIL SMARTFRAME_ADMIN_PASSWORD
npm run admin:create
unset SMARTFRAME_ADMIN_PASSWORD
```

Reexecutar o bootstrap não redefine a senha nem altera o proprietário. Recuperação de senha por e-mail ainda não está disponível. Não edite os hashes manualmente.

Depois, em terminais separados:

```sh
npm run dev
```

```sh
npm run dev:worker
```

Abra **http://localhost:3000**. O worker não é necessário para abrir o painel, mas executa a manutenção da fila.

Para acesso por outro endereço, altere `BETTER_AUTH_URL` no `.env` para a origem exata utilizada, incluindo porta, e reinicie o servidor. Não exponha o servidor de desenvolvimento à internet.

## Verificação e build

```sh
npm run db:generate
npm run check
npm run build
npm run test:smoke
npm run test:smoke:local
npm start
```

Os testes criam um banco isolado em `.data/`, aplicam as migrations e removem seus arquivos no encerramento. Não usam nem apagam o banco de desenvolvimento. O smoke test exige build prévio e inicia um servidor temporário em uma porta livre para verificar o fluxo HTTP real.

O Prisma Client é gerado localmente e não é versionado. Após alterar o schema: `npm run db:dev -- --name nome_da_alteracao`, seguido de `npm run db:generate`. Em implantação, usar somente `npm run db:migrate`.

## Docker Compose

Requer Docker com suporte a containers Linux. Execute `npm run setup:env` ou prepare `.env` manualmente com um segredo aleatório de pelo menos 32 caracteres.

Antes de iniciar, ajuste no `.env`:

```dotenv
BETTER_AUTH_URL=http://localhost:8080
SMARTFRAME_PORT=8080
```

```sh
docker compose up --build -d
docker compose ps
```

A porta é publicada somente em `127.0.0.1` por padrão. Para rede local, configure `SMARTFRAME_BIND=0.0.0.0` e `BETTER_AUTH_URL` com o endereço correto; avalie firewall e HTTPS antes de disponibilizar a terceiros.

Para criar o administrador no volume do Docker, configure as três variáveis `SMARTFRAME_ADMIN_*` no terminal, como acima, e execute:

```sh
docker compose exec -e SMARTFRAME_ADMIN_NAME -e SMARTFRAME_ADMIN_EMAIL -e SMARTFRAME_ADMIN_PASSWORD web npm run admin:create
```

Remova a variável de senha do ambiente após o comando. O banco local de desenvolvimento não é o banco do volume Docker.

O HTTP do Compose é destinado ao acesso local. **Para acesso pela internet, configure terminação TLS em um proxy confiável e uma `BETTER_AUTH_URL` HTTPS.** Não publique o SQLite ou o storage. O exemplo ainda não inclui certificados nem configuração pronta de TLS.

O volume `smartframe_data` mantém banco e mídias entre recriações. `docker compose down` preserva esse volume; **não use `down -v` se desejar manter os dados**.

Ao atualizar uma instalação existente, pare os processos que usam SQLite antes de aplicar migrations:

```sh
docker compose stop nginx web worker
docker compose up --build -d
```

No ambiente Node local, encerre seu web e worker antes de `npm run db:migrate` e reinicie ambos com a versão nova. Isso evita bloqueio do arquivo SQLite durante alterações de schema.

## Android

Veja [apps/android/README.md](apps/android/README.md). É possível instalar as ferramentas localmente no Windows, sem instalar o Android Studio completo:

```powershell
npm run android:setup -- -AcceptSdkLicenses
npm run android:build
```

O APK de debug fica em `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Conecte-o por código no editor para receber o layout Foto; depois da sincronização, a foto e as configurações desse modo permanecem disponíveis offline. O dashboard online é opcional e não tem cache persistente de fotos. O teste prolongado de estabilidade e o carrossel offline de várias fotos permanecem pendentes.

## Documentação

- [PRD](docs/SmartFrame-PRD.md)
- [API implementada](docs/API.md)
- [Operação e limites atuais](docs/OPERATIONS.md)
- [Personalização e conexão do tablet](docs/PERSONALIZATION.md)
- [Clima e moedas](docs/WIDGETS.md)
- [Painel local sem login](docs/LOCAL-ACCESS.md)

## Próximo marco

Ampliar o fluxo já funcional **upload → publicar → tablet baixar → exibir offline** com biblioteca, álbuns e carrossel de múltiplas fotos; depois, evoluir para widgets livres e integrações.
