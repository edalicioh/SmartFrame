# SmartFrame Player online

Dashboard leve, independente do player offline, sem frameworks, service worker ou armazenamento persistente de fotos. O servidor fornece a configuração, as URLs das imagens e dados reais de clima e cotações, com cache de **30 minutos**. As referências cambiais são diárias; não é um feed financeiro em tempo real.

## Publicar e abrir

1. Configure o projeto e pareie o tablet conforme o README principal. Habilite a modalidade para o household correto com `SMARTFRAME_ONLINE_HOUSEHOLD_ID`; veja [`docs/PLAYER-ONLINE-BACKEND.md`](../docs/PLAYER-ONLINE-BACKEND.md) para obter o ID, configurar caminhos, permissões, Docker e segurança.
2. Na raiz do projeto, execute `npm run dev` para desenvolvimento ou `npm run build` seguido de `npm start` para produção. O passo `player:sync` copia esta pasta para `/player-dashboard/`; após editar o frontend, execute `npm run player:sync` novamente (e faça novo build quando necessário). Alterações no JSON ou nas fotos não exigem rebuild.
3. No Android pareado, selecione a modalidade online. O dispositivo deve acessar `https://ENDEREÇO-DO-SERVIDOR/player-dashboard/` pela rede, com certificado confiável; `localhost` no tablet significa o próprio tablet. Não exponha uma instalação insegura à rede pública. O Android envia a credencial nativamente apenas às rotas autorizadas; ela não deve ser colocada no código, URL, armazenamento web ou logs.

Abrir a página em um navegador comum não autentica as rotas de configuração e de imagens: elas exigem o Bearer do dispositivo pareado. A sessão administrativa não o substitui. Na indisponibilidade da API, o dashboard exibe um aviso discreto e mantém o que já estiver carregado, quando possível. Isso não garante funcionamento após fechar ou reabrir a página.

## Fotos e configuração

Por padrão, coloque os arquivos diretamente em `.data/player-online/photos/` no servidor, não em `public/`. Use JPEG (`.jpg`/`.jpeg`), PNG ou WebP, até 16 MiB por arquivo, 4096 pixels em cada eixo e 2.097.152 pixels no total, preferencialmente otimizados próximos à resolução da tela (por exemplo, 1024 × 600). Fotos acima desses limites, arquivos inválidos, links e subpastas são ignorados; nomes são ordenados por bytes UTF-8. Há também limites de tamanho para o álbum, descritos na documentação do backend. O servidor permite sobrescrever os caminhos por `SMARTFRAME_ONLINE_PHOTOS` e `SMARTFRAME_ONLINE_CONFIG`; no Docker, a pasta padrão está no volume do serviço, não necessariamente no diretório local. Todas as fotos ficam acessíveis aos dispositivos autorizados do household selecionado.

Edite `.data/player-online/config.json` no servidor. Exemplo mínimo:

```json
{
  "refreshSeconds": 60,
  "widgets": {
    "photos": { "intervalSeconds": 15, "fit": "cover" },
    "clock": { "format": "24h", "showDate": true },
    "weather": { "city": "Camboriú" }
  }
}
```

O intervalo das fotos é independente da consulta: `photos.intervalSeconds` aceita 5–3600 segundos; `refreshSeconds`, 10–3600; o intervalo das moedas aceita 5–3600. Os valores devem ser inteiros. Tema (`light`/`dark`), visibilidade, posição e largura da foto, relógio, moedas e calendário também podem ser configurados; consulte os campos e limites completos na documentação do backend. Grave o JSON atomicamente para evitar leituras parciais: uma configuração inválida é rejeitada pelo servidor e o player conserva a última válida.

Uma alteração aparece na próxima consulta bem-sucedida, normalmente em até o **intervalo de consulta anterior**, mais o tempo da requisição; falhas causam novas tentativas progressivas e não há prazo garantido sem conexão. Fotos e carrosséis são pausados quando a página está oculta; ao voltar, a consulta é imediata. O layout segue a orientação efetiva da tela: em retrato a foto fica acima dos widgets.

O carrossel pré-carrega a próxima foto no segundo elemento de imagem, reutilizado após a transição. Se ela estiver pronta, a troca ocorre no intervalo configurado; caso contrário, a foto atual é mantida até o carregamento terminar. Em caso de erro, são feitas no máximo três tentativas por ciclo, espaçadas por 250 ms, antes de aguardar outro intervalo. A lista continua a partir do próximo item, sem varrer todo o álbum em sequência rápida.

O backend renova clima e cotações após 30 minutos de cache, independentemente do intervalo das fotos ou da alternância visual das moedas. O polling recebe os novos dados sem recarregar a página. A primeira carga e a renovação podem precisar de uma consulta adicional enquanto os provedores respondem. Valores anteriores são sinalizados em caso de falha; sem cache, aparece indisponibilidade, nunca dados inventados. Veja [fontes e limites](../docs/WIDGETS.md#dashboard-online).

## API JavaScript e testes

`window.applyConfig(objeto)` aceita alterações parciais sobre a configuração atual; propriedades inválidas preservam o valor anterior. Fotos são preservadas quando seu ID e URL continuam na lista. Não chame com credenciais. A consulta usa `GET /api/player/config` na mesma origem, sem requisições sobrepostas, com timeout de 10 segundos e espera progressiva até 5 minutos em caso de erro. Os dados não são gravados no navegador.

Para uma verificação automatizada local com Node 24 e Chrome instalado, execute na raiz:

```sh
node --test smartframe-player/tests/carousel.test.mjs
node smartframe-player/tests/smoke.mjs
```

Use `CHROME_BIN` para apontar para outro Chrome/Chromium ou Edge. O teste usa um servidor local com configuração e imagens simuladas; verifica quatro tamanhos, limites e sobreposição, opções de layout, configuração parcial, calendário e carrossel. Não substitui o teste da integração autenticada real.

Para inspeção manual, abra o player autenticado e use as ferramentas de desenvolvimento do navegador para simular **1024 × 600**, **800 × 480**, **1280 × 800** e **600 × 1024**. Confira navegação e gestos, meses com seis semanas, nomes e datas longos, widgets desativados, fotos removidas/ilegíveis e reconexão. Teste também em segundo plano e no aparelho real. A compatibilidade e o desempenho no PRITOM P7_A1 dependem da versão instalada do Android System WebView e ainda precisam de validação no dispositivo.
