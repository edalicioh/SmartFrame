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

O dashboard recebe dados reais em `widgetData` na resposta autenticada de `/api/player/config`. Clima (Open-Meteo), USD/BRL e EUR/BRL (Frankfurter/BCE) e BTC/BRL (Coinbase) usam cache persistente de 30 minutos, separado do modo Foto. A cidade vem do JSON do servidor. A alternância visual de moedas a cada 10 segundos e o intervalo das fotos não fazem novas consultas aos provedores.

Quando o cache vence, a próxima consulta normal do player inicia a atualização em segundo plano; os valores chegam em uma consulta posterior, sem bloquear fotos. Portanto, há a latência adicional do polling (normalmente até cerca de um minuto por etapa), além da rede. Ao iniciar sem cache, o player mostra que está aguardando dados. Falhas preservam o último valor com indicação de dados anteriores e retentativa após dois minutos. A atualização do cache de câmbio não altera a frequência diária das referências do BCE; sua data é mostrada no cartão. Não são valores demonstrativos nem um feed financeiro em tempo real.
