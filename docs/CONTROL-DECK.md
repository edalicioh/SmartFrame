# Control Deck (Fase 6)

O Modo Control Deck permite acionar controles locais no computador host diretamente pelo tablet pareado, preservando a fronteira de segurança do SmartFrame:

1. **IDs opacos no painel publicado (`bindingId`)**:
   - O JSON do painel publicado (`onlineDashboardSchema`) armazena apenas `id`, `bindingId`, `label` e `icon` em `widgets.controlDeck.tiles`.
   - Caminhos físicos de executáveis, argumentos, diretórios de trabalho, nomes internos de aplicativos e tokens do agente **nunca** são enviados ao navegador nem ao WebView do tablet.

2. **Agente local dedicado (`apps/control-deck-agent`)**:
   - Escuta exclusivamente em endereço de loopback (`127.0.0.1` ou `::1`) na porta `SMARTFRAME_CONTROL_DECK_PORT` (padrão `3789`).
   - Exige token Bearer com pelo menos 32 caracteres (`SMARTFRAME_CONTROL_DECK_TOKEN`) validado via `timingSafeEqual` em todas as rotas (`GET /health`, `GET /status`, `POST /execute`).
   - Atalhos locais só podem ser iniciados a partir de uma allowlist local em JSON (`SMARTFRAME_CONTROL_DECK_SHORTCUTS_FILE`), fora do controle do tablet:
     ```json
     {
       "shortcuts": {
         "terminal": {
           "label": "Terminal",
           "command": "wt.exe",
           "args": []
         }
       }
     }
     ```
   - A API `/status` publica apenas `{ shortcutId, label, available }`, nunca `command`, `args` ou `cwd`.

3. **Variáveis de ambiente do servidor Next.js**:
    - `SMARTFRAME_CONTROL_DECK_URL`: URL HTTP estritamente em loopback (ex.: `http://127.0.0.1:3789`). Qualquer endereço não-loopback é rejeitado.
    - `SMARTFRAME_CONTROL_DECK_TOKEN`: mesmo token configurado no agente local (`>= 32` caracteres).
    - `SMARTFRAME_CONTROL_DECK_HOUSEHOLD_ID`: ID exato da única residência autorizada a usar esse host. Sem essa variável, ou para qualquer outra residência, o agente é tratado como indisponível e comandos são negados.
    - O servidor Next.js e o agente precisam compartilhar o mesmo namespace de rede. Em execução via Docker Compose, `127.0.0.1` aponta para o container do servidor, não para o host; não configure o agente do host por um endereço de rede alternativo, pois isso violaria o limite de loopback. A integração com o Control Deck não está disponível nesse cenário containerizado.

4. **Drivers Windows e Linux e política de estados reais**:
   - **Windows**: `powershell.exe` com scripts estáticos (parâmetros via variáveis de ambiente, sem interpolação de strings): teclas de mídia Win32, Core Audio COM para volume/microfone/sessões de aplicativo, WMI `WmiMonitorBrightness` para brilho e `spawn(..., { shell: false })` para atalhos.
   - **Linux**: `playerctl` (mídia), `pactl` (volume, sessões `sink-input`, microfone) e `brightnessctl` (brilho), sem shell.
   - Integrações ou dispositivos ausentes retornam `available: false` e níveis `null` (nunca exibem valores fictícios).

5. **Segurança Push-to-Talk (_lease_) e sem reenvio cego**:
    - Ações de `mic_ptt` com `hold_unmute` usam _lease_ automático de `2..30` segundos: se a conexão cair ou o agente encerrar, o microfone é silenciado automaticamente no vencimento.
    - Como o microfone e o endpoint são globais no host, uma segunda lease sobreposta é recusada; nova aquisição só é permitida depois de confirmar o mute da lease anterior.
   - Ações não idempotentes (`shortcut`, `media`, toggles e passos relativos) têm `idempotent: false` e **nunca** são reenviadas automaticamente após falha ou timeout pós-envio: o servidor e o player reportam estado `unknown` (`HTTP 504`) e desbloqueiam o controle sem repetir o comando.
