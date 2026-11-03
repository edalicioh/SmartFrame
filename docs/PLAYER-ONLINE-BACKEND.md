# Backend do player online

Esta modalidade é independente do player offline e usa a mesma API Next.js. Fotos e configuração são globais para **um único household explicitamente selecionado**, não para todas as contas. Ela não cria painel, upload, autenticação nova nem cache offline.

## Ativação e arquivos

1. Pareie o tablet pelo procedimento existente. Descubra o ID do household pelo banco local, por exemplo, na raiz do projeto:

   ```sh
   node --env-file-if-exists=.env --import tsx --input-type=module -e 'import {getDatabase} from "@smartframe/database"; const db=getDatabase(); console.log(await db.household.findMany({select:{id:true,name:true}})); await db.$disconnect();'
   ```

   No Docker, consulte o mesmo banco dentro do serviço `web` (com `docker compose exec web` e o comando Node acima, sem `--env-file-if-exists=.env`). Não é o ID do dispositivo. Confirme a conta antes de prosseguir.

2. Defina `SMARTFRAME_ONLINE_HOUSEHOLD_ID` no ambiente do servidor ou `.env` e reinicie o serviço web. Sem esse valor, ou para dispositivos de outro household, a modalidade responde 403. A alteração das variáveis de ambiente exige reinicialização; alterações do JSON e das fotos não exigem build ou reinício.
3. Por padrão, edite `.data/player-online/config.json` e coloque fotos diretamente em `.data/player-online/photos/`, criando as pastas se necessário. A ausência do JSON usa os padrões abaixo; a ausência da pasta resulta em lista vazia. Fora do Docker, `SMARTFRAME_ONLINE_CONFIG` e `SMARTFRAME_ONLINE_PHOTOS` podem apontar para outros caminhos no servidor, absolutos ou relativos à raiz do projeto. Nenhum caminho é aceito do cliente.
4. No Compose, os padrões correspondem a `/app/.data/player-online/config.json` e `/app/.data/player-online/photos/`, no volume persistente `smartframe_data`. O Compose padrão só repassa `SMARTFRAME_ONLINE_HOUSEHOLD_ID`; para caminhos diferentes ou acesso direto às fotos no host, adicione explicitamente variáveis e um bind mount ao serviço `web`, com permissões de leitura para o usuário do processo. Não coloque fotos em `public/`. Faça backup do volume e da configuração.

Exemplo de JSON completo, editável com um editor de texto (não inclua comentários):

```json
{
  "layout": "photo-dashboard",
  "orientation": "landscape",
  "theme": "light",
  "refreshSeconds": 60,
  "layoutOptions": { "photoPosition": "left", "photoWidthPercent": 62 },
  "widgets": {
    "photos": { "enabled": true, "intervalSeconds": 15, "fit": "cover" },
    "clock": { "enabled": true, "format": "24h", "showDate": true, "size": "normal", "color": "" },
    "weather": { "enabled": true, "city": "Camboriú" },
    "currencies": { "enabled": true, "symbols": ["USD", "EUR", "BTC"], "intervalSeconds": 10 },
    "calendar": { "enabled": true, "highlightToday": true }
  }
}
```

Todos os campos são opcionais e recebem esses padrões, inclusive em objetos parciais. `refreshSeconds` aceita inteiros de 10 a 3600; ambos os `intervalSeconds`, inteiros de 5 a 3600. `theme`: `light`/`dark`; `orientation`: `landscape`/`portrait`; `fit`: `cover`/`contain`; relógio: `12h`/`24h`, tamanho `small`/`normal`/`large`, cor vazia ou hexadecimal `#RGB`/`#RRGGBB`. Cidade: 1–80 caracteres. Moedas: lista não vazia, sem duplicatas, de `USD`, `EUR`, `BTC`. Layout: somente `photo-dashboard`; posição da foto `left`/`right`, largura inteira de 40 a 75 por cento. `enabled`, `showDate` e `highlightToday` são booleanos. O consumo das opções de layout depende da implementação do frontend.

`orientation` é reservado para integração futura: o dashboard atual se adapta à orientação real da tela, mas esse campo não gira nem bloqueia a tela remotamente.

Campos desconhecidos, valores fora dos limites e JSON inválido são rejeitados; não há substituição silenciosa de configuração inválida por padrões. Durante uma edição incompleta, a consulta pode falhar: grave outro arquivo e renomeie-o atomicamente sobre o JSON. O cliente deve conservar a última configuração válida. A mudança aparece na próxima consulta bem-sucedida, normalmente em até o `refreshSeconds` **anterior**, mais eventuais retentativas; sem conectividade, não há prazo garantido.

Aceitam-se arquivos regulares `.jpg`, `.jpeg`, `.png` e `.webp`, sem distinção de maiúsculas, com assinatura e metadados compatíveis, no máximo 16 MiB, dimensões positivas de até 4096 por eixo e até 2.097.152 pixels, como no Android. Os metadados são verificados sem decodificar os pixels, usando os mesmos bytes obtidos na leitura protegida contra alterações; isso não garante que a imagem esteja íntegra ou seja decodificável. Fotos fora desses limites ou com cabeçalho inválido são omitidas individualmente da configuração e retornam 404 na rota de foto; não são redimensionadas. Para exibi-las, substitua-as por versões adequadas. Use imagens otimizadas próximas à resolução da tela. Subdiretórios, links simbólicos, hard links, arquivos alterados durante a leitura e arquivos sem permissão de leitura também são omitidos individualmente; neste último caso há diagnóstico genérico no servidor, sem nomes ou caminhos. Os nomes são ordenados deterministicamente por bytes UTF-8. A pasta deve ser administrada por operador confiável e não gravável por usuários ou processos não confiáveis: a proteção de acesso a arquivos não substitui permissões de sistema, isolamento de montagem nem proteção contra troca concorrente de diretórios ancestrais. No Windows, onde `O_NOFOLLOW` pode não estar disponível, não use pasta que possa ser alterada por terceiros.

## Contrato e segurança de acesso

- `GET /api/player/config`: cabeçalho `Authorization: Bearer <token do dispositivo pareado>`. Responde JSON com `revision`, `layout`, `orientation`, `theme`, `refreshSeconds`, `layoutOptions` e `widgets` conforme o exemplo. Acrescenta `widgets.photos.items`, com `id`, `src` relativo à origem e `alt` derivado do nome, sem caminho físico. A revisão é SHA-256 determinística da configuração normalizada e das URLs com hash do conteúdo das fotos: alteração de configuração, adição, remoção, renomeação ou mudança de bytes altera a revisão na próxima varredura bem-sucedida. Consultas simultâneas para os mesmos caminhos compartilham apenas a varredura em andamento; a seguinte relê e calcula hashes, inclusive quando tamanho e datas forem preservados. Uma alteração durante a varredura pode aparecer somente na próxima consulta: não há snapshot transacional, observador ou WebSocket. Para evitar leituras concorrentes inconsistentes, publique fotos por renomeação atômica; arquivos detectados em alteração são omitidos nessa varredura.
- Há no máximo 4096 nomes candidatos com extensão aceita, 128 MiB de arquivos candidatos lidos por varredura e 1 MiB de JSON UTF-8 completo (inclusive revisão), alinhado ao Android. Os bytes são contabilizados antes da leitura, inclusive para arquivos que depois se revelem inválidos ou mudem durante a leitura. Ao exceder qualquer limite, a consulta retorna 413 com erro claro, sem truncar a lista; reduza o álbum ou os nomes. Para limitar I/O repetido, cada processo web tem orçamento compartilhado entre varreduras: rajada de 256 MiB e reposição de até 128 MiB a cada 10 segundos, suficiente para um cliente consultar um álbum no limite no menor intervalo permitido. Vários clientes desencontrados podem consumir esse orçamento mais rapidamente; quando esgotado, a API retorna 429 e deve-se tentar novamente. Erros também consomem os bytes já reservados. O limite não é global entre processos/instâncias e não inclui requisições individuais de imagens; controle adicional de tráfego pode ser necessário na implantação. O cliente deve conservar a última configuração válida diante desses erros.
- `GET /api/player/online-photos/{id}?v={hash}`: mesmo bearer e mesma restrição de household, inclusive após revogação. O ID é opaco para o cliente e **não é segredo**: nomes curtos são codificados em base64url; para nomes longos usa-se SHA-256 do nome, mantendo a URL relativa abaixo de 512 caracteres. A resolução do hash consulta somente nomes válidos do álbum e não interpreta o ID como caminho. A consulta `v` serve para identificar versões no cliente; não autoriza acesso nem garante um snapshot histórico. Se a foto foi substituída após a consulta, a rota fornece a versão atual somente se continuar dentro dos limites. Respostas têm `private, no-store`, tipo correto e `nosniff`; IDs inválidos ou arquivos indisponíveis retornam 404. Não há listagem pública de diretório. 401 indica token ausente/inválido/revogado; 403, household não habilitado. Erros de configuração ou I/O não expõem caminhos físicos.
- Qualquer dispositivo ativo do household selecionado pode acessar **todas** as fotos dessa pasta. Não há seleção por dispositivo ou por usuário; não a utilize se esse compartilhamento for inadequado. O token não deve aparecer em URL, JSON, página, log, ponte JavaScript ou armazenamento web.

Para o Android online, use o token já guardado no armazenamento nativo seguro, sem alterá-lo. O WebView precisa abrir a página somente da origem HTTPS confiável configurada e interceptar nativamente os GETs exatamente de `/api/player/config` e `/api/player/online-photos/{id}` **na mesma origem**; o código nativo encaminha cada requisição com o bearer e devolve status, tipo e corpo ao WebView. Não adicionar o cabeçalho globalmente, a domínios externos ou a redirecionamentos; não seguir redirects autenticados; bloquear navegação para fora da origem, mixed content e requisições não permitidas. Impor limites de resposta e timeouts. Isso é necessário também para imagens `<img>`, que não recebem automaticamente o header de um `fetch`. Usar TLS com certificado confiável e endereço alcançável pelo tablet, nunca `localhost` do servidor. Revogação passa a valer na próxima requisição; pixels já exibidos não podem ser apagados remotamente.

O APK atualizado oferece o dashboard online como modo opcional, selecionado explicitamente após o pareamento; o modo offline permanece padrão. Consulte [as instruções Android](../apps/android/README.md#dashboard-online-opcional). Simplesmente abrir a página em um navegador não autentica fotos ou configuração: o endpoint não aceita sessão do painel nem modo local sem login como alternativa ao bearer. A resposta inclui `widgetData` com clima e cotações reais em cache de 30 minutos; veja [fontes e atualização](WIDGETS.md#dashboard-online). Esse payload varia independentemente da revisão do layout; não se usa ETag da configuração para validar os dados dos widgets.
