# API — SmartFrame Online 0.4.0

> **Integração online por dispositivo v0.4.** As rotas abaixo correspondem à
> implementação integrada atualmente disponível; endpoints do player offline mais
> adiante são legado/compatibilidade e não o fluxo primário do APK.

## Painéis online e dispositivos

O editor mantém painéis independentes e publica uma versão para cada dispositivo. `GET` e alterações usam a sessão
administrativa existente; não exigem `SMARTFRAME_ONLINE_HOUSEHOLD_ID`. Um ID de
dispositivo identifica o destino, não é uma credencial nem autoriza chamadas Bearer.

| Método | Endpoint                          | Contrato-alvo                                                                |
| ------ | --------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/panels`                     | Lista painéis da residência                                                  |
| GET    | `/api/panels?id=ID`               | Retorna `{id,name,config,draftRevision}`                                     |
| POST   | `/api/panels`                     | Cria `{name,copyFromId?}`; cópia usa o rascunho salvo                        |
| PUT    | `/api/panels`                     | Salva `{id,config,expectedRevision}` sem alterar dispositivos                |
| PATCH  | `/api/panels`                     | Renomeia `{id,name}`                                                         |
| DELETE | `/api/panels`                     | Exclui `{id}` se não estiver em uso por dispositivos ativos                  |
| POST   | `/api/panels/publish`             | Publica `{panelId,deviceId,expectedRevision}`; retorna `{revision}` imutável |
| GET    | `/api/devices/panels?deviceId=ID` | Lista versões disponibilizadas ao dispositivo para administração             |
| DELETE | `/api/devices/panels`             | Remove `{deviceId,panelId}` das opções, exceto o painel atualmente enviado   |
| GET    | `/api/photos`                     | Biblioteca de fotos disponível ao editor autenticado                         |
| POST   | `/api/photos`                     | Multipart `photo`; processamento otimizado no recebimento                    |

`GET /api/devices` retorna `activePanelId`, `activePanelVersionId` e `appliedRevision` para acompanhar a publicação. As rotas `/api/online-frame` permanecem disponíveis para compatibilidade com o fluxo anterior.
Na publicação, `activate` é opcional e vale `true` por padrão. Com `false`, a versão
é disponibilizada para o dispositivo sem alterar o painel enviado. Publicar diretamente
também disponibiliza a versão para trocas futuras. Cada dispositivo mantém sua própria
versão aprovada; publicar em outro não a atualiza. Exclusão de um painel remove também
suas permissões, mas continua proibida enquanto ele estiver enviado a dispositivo ativo.
A rota de compatibilidade `/api/online-frame/publish` também atualiza a versão aprovada
na mesma transação. Se outro painel estiver ativo, ele permanece enviado ao dispositivo;
a nova publicação legada fica disponível apenas para uma escolha posterior.
Configuração compartilhada e defaults estão em `packages/contracts/src/online-dashboard.ts`.
O endpoint de upload gera imagem ajustada para caber em 1024×600 preservando
proporção, via Sharp. Testes automatizados não substituem validação em aparelho real.

## Player online pareado

- `GET /player/{deviceId}` serve a página pareada. O ID na URL não é segredo.
- `GET /api/player/config?deviceId=ID` retorna somente a configuração publicada do
  dispositivo. A consulta periódica é a cada 15 segundos por padrão.
- Na consulta seguinte, o player envia `appliedRevision=online%3AVERSION` em
  `GET /api/player/config`, somente após aplicar a configuração com sucesso. O
  servidor só registra a confirmação se ela corresponder à publicação atual.
  Receber a resposta não confirma aplicação. `POST /api/player/heartbeat` permanece
  exclusivo do protocolo legado, não é utilizado pelo APK v0.4.
- `GET /api/player/online-media/{id}?v=sha256` entrega mídia da publicação autorizada.
- `GET /api/player/panels` lista apenas painéis disponibilizados ao dispositivo autenticado,
  além do painel enviado e revisões enviada/aplicada. `POST /api/player/panels`, com
  `{panelId}`, ativa a versão aprovada para o próprio dispositivo e retorna `{revision}`.
  A resposta confirma o envio, não a aplicação; a confirmação continua no polling.
  Ambas as chamadas usam o Bearer nativo do dispositivo e não expõem a credencial ao JavaScript.
- A prévia administrativa usa `/player-dashboard/index.html?preview=1` e `postMessage`
  limitado à mesma origem.

Uma página aberta em navegador comum não ganha autorização para APIs Bearer por
conhecer o ID. O alvo primário é o APK pareado, cuja camada nativa mantém a credencial
fora do JavaScript. Produção exige HTTPS; HTTP de debug somente via loopback e
`adb reverse`. Tela cheia imersiva não equivale a Android lock-task/kiosk.

O armazenamento reutiliza `Layout` e `LayoutVersion`; uma migration associa cada
dispositivo existente ao seu painel e à versão já publicada. Cada dispositivo mantém
sua própria versão atribuída, sem ser alterado por publicações para outro dispositivo.
Uma migration posterior disponibiliza somente a publicação atual de cada dispositivo;
nenhum outro painel é liberado automaticamente. Faça backup e execute `npm run db:migrate`
antes de iniciar a versão nova. Não há troca offline nem garantia de retomada offline do APK.
Rotas offline antigas podem permanecer para compatibilidade, mas não são o caminho
principal do editor ou do APK v0.4.

Somente os endpoints descritos nesta página estão implementados. A lista mais ampla do PRD é o alvo futuro.

## Saúde

`GET /api/health`

- Público, sem informações pessoais.
- `200`: banco acessível e schema inicial aplicado; retorna `status`, `service` e `version`.
- `503`: schema ausente ou banco indisponível; não revela o erro interno.
- Não atesta o funcionamento do worker nem de módulos futuros.

## Autenticação

Com `SMARTFRAME_ADMIN_LOGIN=disabled`, o painel/API administrativos usam o perfil local, sem sessão, apenas na origem de loopback configurada. `/login` redireciona ao início e `/api/auth/*` retorna 404. Alterações mantêm verificação de `Origin`; credenciais do player não mudam. Veja [o modo local](LOCAL-ACCESS.md).

Better Auth é montado em `/api/auth/*`. A implementação usa as rotas nativas da biblioteca, não os aliases conceituais `/api/auth/login` e `/api/auth/logout` do PRD.

| Método | Endpoint                | Descrição                                                  |
| ------ | ----------------------- | ---------------------------------------------------------- |
| POST   | /api/auth/sign-in/email | Recebe `email` e `password`, cria sessão e cookie HttpOnly |
| POST   | /api/auth/sign-out      | Revoga sessão e limpa cookie                               |
| GET    | /api/auth/get-session   | Consulta a sessão do navegador                             |

- Usar o cliente Better Auth no navegador e enviar os cookies em requisições autenticadas.
- A origem deve corresponder a `BETTER_AUTH_URL`.
- Cookies `Secure` são usados quando a origem configurada utiliza HTTPS.
- A tentativa de cadastro público é bloqueada.
- O login limita a cinco tentativas por minuto por chave de limitação da biblioteca; Nginx adiciona limitação por IP no Compose.
- Não armazenar tokens de sessão no localStorage.

Exemplo de corpo de login:

```json
{ "email": "seu-email@exemplo.com", "password": "sua-senha" }
```

## Dispositivos

`GET /api/devices`

- Requer sessão administrativa válida.
- Retorna apenas dispositivos não revogados da conta cujo proprietário é o usuário autenticado.
- Máximo inicial de 100 registros, em ordem decrescente de criação.
- Não retorna hash de token nem credenciais.
- `401`: não autenticado. `403`: usuário sem conta autorizada.
- Resposta com `Cache-Control: private, no-store`.

```json
{ "data": [] }
```

Quando houver dispositivos, cada item conterá `id`, `name`, `timezone`, `lastSeenAt`, `appliedRevision`, `activePanelId`, `activePanelVersionId` e `createdAt`.

## Personalização e pareamento administrativos

Requerem sessão do proprietário. Métodos de alteração também exigem `Origin` igual à origem configurada em `BETTER_AUTH_URL`. Respostas são privadas e não cacheáveis.

| Método | Endpoint                  | Descrição                                                                                                |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | /api/frame                | Rascunho, `draftRevision`, `publishedRevision`, foto selecionada, dispositivos e instante de verificação |
| PUT    | /api/frame                | Salva `{config, expectedRevision}`; retorna `draftRevision` atualizado                                   |
| POST   | /api/frame/publish        | Publica `{expectedRevision}`; retorna revisão imutável                                                   |
| POST   | /api/photos               | Multipart com campo `photo`; retorna 202 com identificador e estado inicial                              |
| GET    | /api/photos/{id}          | Consulta processamento: pending, ready ou error                                                          |
| GET    | /api/photos/{id}/image    | WebP pronto, somente da conta autenticada                                                                |
| POST   | /api/devices/pairing-code | Emite código de uso único, `expiresAt` e `serverURL`                                                     |
| DELETE | /api/devices/{id}         | Revoga dispositivo e credencial, sem prometer apagar conteúdo offline                                    |

O contrato `config` está em `packages/contracts/src/photo-frame.ts`. Uma revisão antiga de rascunho retorna 409, sem sobrescrever o trabalho de outra sessão. A publicação valida a foto pronta e não é afetada por edições posteriores do rascunho.

Uploads aceitam JPEG, PNG e WebP estático, até 12 MB e 24 MP. O worker verifica o conteúdo real e gera WebP de até 1600 × 1600/4 MB. O endpoint não executa otimização pesada dentro da requisição.

## Player Android

### Endpoints de widgets

- `GET /api/widgets/cities?q=NOME`: busca até seis cidades para selecionar coordenadas/fuso.
- `POST /api/widgets/preview`: recebe `{config}`, usa cache e fontes e retorna snapshots.
- `config.widgets` habilita os cartões e sua posição. Layouts antigos recebem cartões desativados por padrão.
- `widgetData` no manifesto contém clima/cotações. Novos snapshots não exigem outra revisão do layout; o player compara e persiste os dados sem alterar a publicação aplicada.

### Credenciais do dispositivo

Cookies administrativos não autorizam estes endpoints. Após o pareamento, usar `Authorization: Bearer TOKEN_DO_DISPOSITIVO` na camada Kotlin.

| Método | Endpoint               | Descrição                                                                           |
| ------ | ---------------------- | ----------------------------------------------------------------------------------- |
| POST   | /api/player/pair       | Público e limitado; recebe `{code,name}` e devolve `{deviceId,token}` uma única vez |
| GET    | /api/player/manifest   | Manifesto publicado; 204 se ainda não houver publicação                             |
| GET    | /api/player/media/{id} | Somente a mídia autorizada pela publicação atual da conta do dispositivo            |
| POST   | /api/player/heartbeat  | Recebe `{revision}` e registra último contato e aplicação confirmada                |

O manifesto continua usando `schemaVersion:1`, com `layout.photoFrame` para esta etapa e no máximo uma imagem de fundo. Contém revisão, dispositivo, dimensões, configurações, hash/tamanho/path da mídia e parâmetros de sincronização. Nunca inclui credenciais administrativas ou de integrações.

As credenciais são armazenadas como hash no servidor e criptografadas pelo Keystore no Android. Código resgatado ou expirado retorna 400; tentativas excessivas retornam 429. Dispositivo revogado recebe 401. Mídia de outra conta ou fora da publicação atual recebe 404.

Este fluxo inicial usa código gerado no painel e digitado no APK. Álbuns, carrossel e os demais endpoints conceituais do PRD ainda serão implementados.
