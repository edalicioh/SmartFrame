# Temperatura e moedas — 0.3

Cartões com fundo escuro, bordas arredondadas e títulos rosa, seguindo a referência. São sobrepostos à foto e podem ser colocados nos quatro cantos pelo editor.

## Configuração

1. Abra `/layouts` e localize **Temperatura e moedas**.
2. Ative os cartões desejados.
3. Busque e selecione uma cidade. A seleção ajusta o fuso, que pode ser alterado depois.
4. Escolha um canto, preferencialmente diferente do relógio.
5. Confira a prévia e publique no tablet.

São Paulo é apenas o exemplo inicial configurável. Não há coleta automática da localização. Layouts antigos mantêm os cartões desativados até serem editados/publicados.

## Fontes e cache

| Dados                                       | Fonte                |
| ------------------------------------------- | -------------------- |
| Temperatura atual, máxima/mínima e condição | Open-Meteo           |
| USD/BRL e EUR/BRL — referências diárias     | Frankfurter          |
| BTC/USD — spot consultado periodicamente    | Coinbase             |
| Nome, coordenadas e fuso das cidades        | Open-Meteo Geocoding |

- Consultas no servidor, sem API keys pagas e sem encaminhar tokens dos tablets.
- Cache válido por 30 minutos. O worker revisa publicações a cada cinco minutos; publicar também agenda revisão. A prévia utiliza o mesmo cache.
- Não são cotações em tempo real. O cartão mostra data das referências cambiais e horário do BTC.
- Falhas esperam dois minutos para nova tentativa, sem apagar os últimos valores válidos.
- Dados com mais de 30 minutos, ou cuja fonte falhou, são identificados como anteriores. O player também verifica a idade offline.
- Sem resultado prévio, aparece indisponibilidade, nunca um valor inventado.
- Fontes têm limites e termos próprios. O plano gratuito Open-Meteo é voltado ao uso não comercial; avaliar licença antes de distribuir comercialmente.

O renderizador HTML não acessa a internet. Kotlin recebe os snapshots no manifesto e os persiste. Novos dados podem chegar sem outra publicação de layout; a revisão aplicada continua identificando o layout.

Hosts HTTPS são fixos; o usuário não fornece URLs externas. Respostas têm timeout, tamanho máximo e validação numérica. Falha de uma fonte não interrompe a outra, as fotos ou o relógio.

O cache de clima é separado por coordenadas/fuso; cotações públicas são compartilhadas internamente. Ainda são cartões predefinidos, não widgets livres com drag-and-drop.

## Dashboard online

O dashboard recebe dados reais em `widgetData` na resposta autenticada de `/api/player/config`. Clima (Open-Meteo) usa cache persistente de 30 minutos. Cotações indicativas (Coinbase Exchange Rates) usam cache persistente de 30 minutos por moeda de origem, compartilhado entre dispositivos e prévia. O editor permite selecionar de 1 a 20 pares entre USD, BRL, EUR, GBP, JPY, CAD, AUD, CHF, BTC e ETH, como USD/BRL e BTC/USD, e de uma a quatro cotações simultâneas, respeitando o espaço do cartão. Publicações antigas com `symbols` são convertidas para os pares correspondentes em BRL. A alternância visual e o intervalo das fotos não forçam novas consultas aos provedores.

Quando o cache vence, a próxima consulta do player inicia a atualização em segundo plano; os valores chegam em uma consulta posterior, sem bloquear fotos. Há latência adicional do polling e da rede; com moedas habilitadas, o polling não ultrapassa 30 minutos. Sem cache ou com atualização pendente, uma nova consulta em dois segundos busca os valores enquanto a fonte responde. O cartão mostra somente o par e o valor centralizados, ou um traço quando não há cotação. Falhas preservam o último valor; a fonte, o horário da consulta e a indicação de dados anteriores ficam na dica ao passar o mouse, com retentativa de câmbio após dois minutos. A prévia usa `/api/online-frame/widgets` com sessão administrativa e validação de origem, sem credencial de dispositivo, inclusive para pares ainda não salvos. O polling interno da prévia não força consultas externas antes dos 30 minutos. Não são valores demonstrativos, preços de execução nem um feed financeiro em tempo real por segundo. O modo Foto legado mantém suas fontes e seu cache anteriores.
