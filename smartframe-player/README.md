# SmartFrame Player online

Dashboard leve da v0.4, sem frameworks, service worker, armazenamento persistente
de fotos ou credenciais no JavaScript. O APK pareado abre `/player/{deviceId}` e
mantém a credencial no Android Keystore.

## Publicar e abrir

1. Inicie o servidor e o worker conforme o README principal.
2. Em `/layouts`, gere um código e pareie o APK. Uma atualização com assinatura
   compatível preserva o pareamento existente; não desinstale para atualizar.
3. Selecione o dispositivo no editor, envie fotos, aguarde o processamento e escolha
   a ordem do carrossel. Ajuste cores, widgets e intervalos na prévia.
4. Salve o rascunho e publique. O player recebe a nova publicação na próxima consulta,
   normalmente em até 15 segundos, sem recarregar a página.

O novo fluxo usa `Layout`/`LayoutVersion` e a biblioteca do banco existente. Não
requer `SMARTFRAME_ONLINE_HOUSEHOLD_ID` nem edição de JSON/pastas. O modo anterior
está documentado apenas como [histórico](../docs/PLAYER-ONLINE-BACKEND.md).

O ID identifica o dispositivo, mas não autoriza acesso. Um navegador comum sem o
Bearer não consegue consultar a configuração ou as fotos. A prévia administrativa
usa sessão do painel e `/player-dashboard/index.html?preview=1`, sem polling ou
confirmações de revisão.

## Fotos, widgets e atualização

- Upload: JPEG, PNG ou WebP, até 12 MB e 24 MP de entrada. O worker aplica rotação
  EXIF e otimiza com Sharp para caber em **1024 × 600**, preservando proporção.
- Até 100 fotos distintas por publicação. Só fotos prontas da mesma conta podem
  ser publicadas. O dispositivo acessa apenas fotos da sua publicação atual.
- Layout horizontal padrão: **62% fotos / 38% widgets**. Em retrato, a foto fica
  acima dos widgets. A orientação acompanha a tela; não há bloqueio remoto de rotação.
- Intervalo de fotos e alternância de moedas: 5–3600 s. Polling do layout: 10–3600 s,
  padrão 15 s (limitado a 30 min com moedas habilitadas). São intervalos independentes.
- Clima é consultado pelo servidor com cache de 30 minutos. Cotações indicativas da
  Coinbase usam cache de **30 minutos**, compartilhado entre dispositivos e prévia.
  Escolha de 1 a 20 pares (USD, BRL, EUR, GBP, JPY, CAD, AUD, CHF, BTC e ETH), como
  USD/BRL ou BTC/USD, e até quatro cotações por vez. O cartão se adapta ao espaço e
  alterna os demais pares. O cartão mostra apenas o par e o valor centralizados; fonte, horário e
  indicação de dados anteriores ficam na dica ao passar o mouse. Sem cotação, mostra
  um traço, nunca valores fictícios. Não é um feed financeiro por segundo.
- Carrossel usa dois elementos de imagem, sem pré-carregar o álbum inteiro.
- A configuração aplicada é confirmada na consulta seguinte por `appliedRevision`;
  isso confirma aplicação do layout, não prova que todos os pixels foram exibidos.

Sem conexão, o player conserva o que já estiver carregado quando possível e mostra
um aviso. Não há promessa de funcionamento após fechar ou reabrir sem o servidor.
Reconexão usa timeout e espera progressiva, sem consultas sobrepostas. Ao voltar à
página ou recuperar a rede, a consulta é imediata.

## Segurança e acesso

Use HTTPS com certificado confiável em produção/LAN. HTTP no APK debug é restrito
a loopback; `localhost` no tablet só alcança o computador com `adb reverse` ativo.
Fullscreen e tela ligada não equivalem ao modo kiosk/lock-task completo do Android.
Credenciais não devem aparecer em URL, logs, mensagens da prévia ou armazenamento web.

## Testes

```sh
npm run test:player
node smartframe-player/tests/smoke.mjs
```

O teste visual usa Chrome/Chromium ou `CHROME_BIN` e verifica **1024 × 600**,
**800 × 480**, **1280 × 800** e **600 × 1024**, com configurações e fotos simuladas.
O smoke HTTP do projeto verifica a integração autenticada com banco isolado.
Esses testes não substituem validação do APK no PRITOM P7, da versão efetiva do
Android System WebView, da reconexão e da estabilidade prolongada.
