# Plano de execução — SmartFrame Player online

## Objetivo e escopo

Criar um player visual para o SmartFrame, baseado no layout de referência: uma foto em destaque à esquerda e cartões de relógio, clima, cotações e calendário à direita. O alvo principal é um tablet PRITOM P7_A1, Android 11, ARM Cortex-A53, aproximadamente 1,4 GB de RAM e tela horizontal de 1024 × 600. A interface deve ser leve, responsiva e funcionar no Android WebView.

Esta nova modalidade será **online**: as fotos ficam em uma pasta no servidor e o app as carrega por URL. O backend também determina o intervalo de troca das fotos. Não implementar armazenamento persistente das imagens, service worker ou sincronização offline para essa modalidade.

Implementar somente o frontend do player e a integração mínima necessária no backend existente para listar e servir as fotos e fornecer a configuração. Não criar painel administrativo, upload de fotos, novo sistema de autenticação ou banco de dados para esta funcionalidade.

## 1. Inspecionar e preservar o projeto

O projeto já contém:

- Backend e painel Next.js em `apps/web/`.
- Aplicativo Android em `apps/android/`.
- Player atual em `packages/player/src/`.
- Script de distribuição em `scripts/sync-player.mjs`.

Antes de implementar:

1. Leia as instruções `AGENTS.md` aplicáveis e verifique o estado dos arquivos existentes.
2. Entenda como o backend serve imagens, como o Android abre o player, quais políticas de segurança são aplicadas e como funcionam os testes e contratos existentes.
3. Preserve os dados, a autenticação, o painel e as funcionalidades atuais.
4. Crie o novo player separadamente em `smartframe-player/`. Não substitua o player antigo nem remova seu funcionamento offline.

## 2. Estrutura do novo player

```text
smartframe-player/
├── index.html
├── README.md
├── css/
│   ├── base.css
│   ├── layout.css
│   ├── widgets.css
│   └── themes.css
├── js/
│   ├── app.js
│   ├── config.js
│   ├── carousel.js
│   ├── clock.js
│   ├── calendar.js
│   ├── weather.js
│   └── currencies.js
└── assets/
    └── icons/
```

As fotos ficam no servidor, não empacotadas no player. Use JavaScript externo, HTML5 semântico, CSS Grid e Flexbox, CSS Custom Properties e SVGs simples. Não usar React, Vue, Angular, Tailwind, Bootstrap, bibliotecas de componentes ou fontes externas obrigatórias no novo player. Evitar dependências externas e animações pesadas.

## 3. Configuração e fotos no backend

1. Reutilize o backend existente; não crie outro servidor.
2. Adicione uma configuração persistente simples, seguindo os padrões do projeto. Um arquivo JSON é suficiente. Ela deve poder ser alterada sem novo build.
3. Permita configurar o intervalo de troca das fotos, o intervalo de consulta da configuração, tema, cidade, visibilidade dos widgets, formato do relógio, intervalo das moedas e opções suportadas de ordem e proporção do layout.
4. Configure no servidor a pasta de fotos; nunca aceite do player um caminho físico arbitrário.
5. Implemente ou reutilize rotas que listem os arquivos em ordem determinística e os sirvam por URLs acessíveis pelo tablet. Adicionar ou remover um arquivo deve refletir na próxima consulta, sem observador contínuo de arquivos.
6. Aceite JPEG, PNG e WebP. Não exponha caminhos físicos nem permita acesso fora da pasta autorizada. Preserve os controles de acesso existentes e não coloque segredos no frontend.
7. Não dependa de listagem pública de diretórios. As URLs devem funcionar a partir do tablet, sem depender do `localhost` do computador.

### Endpoint de configuração

Nome sugerido, adaptável aos padrões existentes: `GET /api/player/config`.

```json
{
  "revision": "12",
  "layout": "photo-dashboard",
  "orientation": "landscape",
  "theme": "light",
  "refreshSeconds": 60,
  "widgets": {
    "photos": {
      "enabled": true,
      "intervalSeconds": 15,
      "fit": "cover",
      "items": [
        { "id": "familia", "src": "/media/photos/familia.webp", "alt": "Família" },
        { "id": "praia", "src": "/media/photos/praia.webp", "alt": "Praia" }
      ]
    },
    "clock": { "enabled": true, "format": "24h", "showDate": true },
    "weather": { "enabled": true, "city": "Camboriú" },
    "currencies": {
      "enabled": true,
      "symbols": ["USD", "EUR", "BTC"],
      "intervalSeconds": 10
    },
    "calendar": { "enabled": true, "highlightToday": true }
  }
}
```

A revisão deve mudar quando a configuração ou a lista de fotos mudar, mas não simplesmente por uma consulta. Valide os intervalos, rejeite valores inválidos e documente os limites adotados. Não há exigência de WebSocket.

## 4. Layout e design

No modo horizontal:

- Ocupar toda a tela, sem barras de rolagem; usar `100vh` com `100dvh` como melhoria progressiva.
- Usar margem externa aproximada de `10px` e espaçamento de `8px`.
- Colunas de `62fr 38fr`, descontando o espaço entre elas. Fotos ocupam toda a coluna esquerda.
- À direita, relógio, clima, moedas e calendário com proporções aproximadas de `18fr 16fr 19fr 47fr`, descontando os espaços.
- Usar `min-width: 0`, `min-height: 0` e dimensionamento adequado. Não esconder erros de dimensionamento apenas com `overflow: hidden`.

Em retrato, colocar as fotos em destaque na parte superior e os demais widgets abaixo, sem rolagem nem sobreposição. O layout deve se adaptar à desativação de widgets.

Usar cantos de aproximadamente `18px`, sombras discretas e paleta inicial:

| Uso              | Cor       |
| ---------------- | --------- |
| Fundo            | `#E8EEF5` |
| Primária         | `#2563EB` |
| Escura           | `#102A43` |
| Superfície       | `#FFFFFF` |
| Texto            | `#172033` |
| Texto secundário | `#64748B` |
| Sucesso          | `#16A34A` |

Relógio em azul-escuro, clima em azul, moedas em azul-marinho e calendário em superfície clara. Evitar filtros e efeitos de blur pesados.

## 5. Implementar os componentes

### Fotos

- Carregar a lista e as imagens por URL; troca automática no intervalo configurado pelo backend, inicialmente 15 segundos.
- Controles anterior/próxima, indicadores discretos e gestos de deslizar.
- `object-fit` configurável, normalmente `cover`, e transição curta de opacidade.
- Reutilizar dois elementos de imagem, atual e próxima, sem pré-carregar o álbum inteiro.
- Tratar lista vazia e falhas de carregamento. Limitar tentativas para evitar ciclos rápidos quando todas as fotos falharem.

### Relógio

- Exibir hora local do dispositivo em formatos 12h ou 24h e data em português.
- Atualizar alinhado à mudança real de minuto.
- Permitir configuração de tamanho, cor e visibilidade da data.

### Clima

- Mostrar cidade, condição, temperatura atual, máxima e mínima, com ícone SVG.
- Usar dados simulados e exibir claramente **“Demonstração”**.
- Separar serviço e renderização para integração futura com Open-Meteo ou outra API, sem chaves privadas no frontend.

### Moedas

- Exibir USD/BRL, EUR/BRL e BTC/BRL, com símbolo, código, valor e variação quando disponível.
- Alternar automaticamente grupos de moedas em intervalo configurável, especialmente quando não couberem todos.
- Identificar valores como **“Demonstração”**, nunca como cotações reais. Preparar o serviço para dados futuros do backend.

### Calendário

- Mostrar mês e ano, cabeçalho DOM a SÁB, grade de sete colunas e dias de meses adjacentes com menor destaque.
- Permitir navegar entre meses e voltar ao mês atual; destacar hoje em círculo colorido quando configurado.
- Calcular corretamente meses com seis semanas, diferentes durações e anos bissextos.
- Atualizar a data após a meia-noite sem interromper uma navegação manual para outro mês. Preparar a estrutura para futuros indicadores de eventos.

## 6. Aplicação da configuração e atualização online

Implementar `applyConfig(config)` para:

1. Validar e normalizar a configuração e aceitar alterações parciais sobre os valores atuais.
2. Atualizar apenas os componentes afetados e reorganizar o espaço quando widgets forem desativados.
3. Não duplicar timers ou listeners em aplicações sucessivas.
4. Preservar a foto atual se ela continuar na lista.
5. Reiniciar a contagem do carrossel quando o intervalo de troca mudar.

Consultar o backend ao iniciar e depois conforme `refreshSeconds`, inicialmente 60 segundos. Não permitir requisições sobrepostas; implementar timeout e tentativas com espera progressiva em caso de falha. Suspender consultas e carrosséis quando a aplicação estiver oculta e atualizar imediatamente ao retornar.

O intervalo de troca de fotos e o intervalo de consulta são independentes: mudanças no backend são aplicadas na próxima consulta. Sem conexão, preservar a imagem já carregada enquanto possível e indicar indisponibilidade discretamente. Não prometer funcionamento offline após fechar e reabrir o app.

## 7. Disponibilização no navegador e no Android

1. Publique o novo player em uma URL própria, por exemplo `/player-dashboard/`.
2. Adapte a distribuição para incluir as subpastas necessárias, sem quebrar a prévia ou o player atual.
3. Reutilize o mecanismo Android existente quando possível. Para esta modalidade, o WebView deve abrir a URL online do novo player.
4. Não migre nem desative automaticamente dispositivos existentes.
5. Verifique a versão efetiva do WebView: a versão Android, por si só, não garante suporte a todos os recursos CSS e JavaScript.

## 8. Testes e aceitação

Validar visualmente em 1024 × 600, 800 × 480, 1280 × 800 e 600 × 1024. Conferir ausência de rolagem, textos cortados e sobreposição, inclusive com datas longas e meses de seis semanas.

Testar:

- Gestos, botões, indicadores e troca automática.
- Pasta vazia, arquivo inválido ou removido e backend indisponível.
- Alteração da lista durante uma transição.
- Mudança do intervalo pelo backend sem recarregar a página.
- Chamadas repetidas de `applyConfig()` sem multiplicação de timers.
- Pausa e retomada em segundo plano.
- Temas, configuração parcial e widgets desativados.
- Anos bissextos, mudança de mês e dia atual.
- Regressões do player antigo e dos fluxos existentes.

Não declarar desempenho ou compatibilidade no PRITOM como comprovados sem teste no aparelho.

## 9. Documentação e entrega

O README do novo player deve explicar como executar e abrir no tablet, onde colocar fotos no servidor, como alterar o intervalo no backend, quanto tempo uma alteração leva para aparecer, formatos e tamanhos recomendados, como testar as quatro resoluções, quais dados são demonstrativos e as limitações da modalidade online.

**Critério de conclusão:** dashboard visualmente fiel à distribuição de referência, sem rolagem nas resoluções-alvo, com fotos servidas por URL e intervalo definido pelo backend aplicado sem recarregar a página, preservando o sistema existente.
