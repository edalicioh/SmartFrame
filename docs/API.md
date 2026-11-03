# API — modo Foto 0.3.0

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

Quando houver dispositivos, cada item conterá `id`, `name`, `timezone`, `lastSeenAt`, `appliedRevision` e `createdAt`.

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
