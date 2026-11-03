# SmartFrame Player — modo Foto 0.2

Projeto Kotlin com minSdk 26, WebView local e modo Foto configurável pelo painel: foto de fundo, relógio/data, cores, mensagem, orientação, pareamento, download verificado, polling e cache persistente. Oferece também um dashboard online opcional com carrossel; esse modo não possui cache persistente. O modo Foto ainda não contém álbuns ou carrossel offline, e o aplicativo não é o APK final da V1.

## Ambiente local no Windows

Não é necessário instalar o Android Studio completo. Na raiz do monorepo:

```powershell
npm run android:setup -- -AcceptSdkLicenses
npm run android:build
```

O primeiro comando instala em `.data/android-toolchain/`, sem alterar variáveis globais do Windows:

- Eclipse Temurin JDK 21 LTS; o aplicativo continua compilado para bytecode Java 17.
- Gradle 8.13, compatível com AGP 8.13.2.
- Android Command-line Tools, SDK 36, Build Tools 35.0.0 e Platform Tools.
- Cache Gradle local ao projeto.

Os arquivos ZIP de Java, Gradle e Command-line Tools são verificados por SHA-256 antes da extração. Os componentes do SDK são instalados pelo `sdkmanager` oficial.

O parâmetro `-AcceptSdkLicenses` autoriza o aceite das [licenças do SDK Android](https://developer.android.com/studio/terms). O registro fica em `.data/android-toolchain/sdk-licenses.log`. Os downloads e caches podem ocupar alguns GB; essa pasta é ignorada pelo Git e pelo Docker.

O build também gera o Gradle Wrapper oficial com checksum da distribuição fixado e executa `assembleDebug` e `lintDebug`. O próprio Gradle copia o renderizador de `packages/player/src` para os assets gerados; não é necessário duplicá-lo manualmente. O APK fica em:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

Para usar as ferramentas em uma sessão PowerShell:

```powershell
. ./scripts/android-env.ps1
java -version
gradle --version
```

Também é possível abrir esta pasta no Android Studio usando seu próprio SDK/JDK compatível. O mínimo do AGP é JDK 17; a instalação portátil usa JDK 21. Não há código nativo dependente de uma ABI específica neste protótipo, mas o APK e a WebView devem ser validados no PRITOM de 32 bits.

## Instalação de teste por USB

Com a depuração USB autorizada:

```powershell
adb devices -l
adb -s SERIAL_DO_TABLET install apps/android/app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL_DO_TABLET shell am start -W -n com.smartframe.player/.MainActivity
```

O APK é assinado com chave de debug, não de distribuição. Não substitua uma instalação existente sem verificar sua origem e assinatura. Para atualizar uma instalação de debug sua, mantenha a chave e use `adb install -r`. Veja [conexão e personalização](../../docs/PERSONALIZATION.md).

## Segurança inicial

- Interface embarcada servida pelo WebViewAssetLoader em origem HTTPS local.
- Sem acesso a arquivos arbitrários, navegação externa ou ponte JavaScript.
- Comunicação pela camada Kotlin, com credencial criptografada pelo Android Keystore e fora do JavaScript.
- Rede bloqueada no renderizador pela CSP; imagens baixadas são servidas por uma origem local autorizada.
- Downloads com tamanho, hash e dimensões verificados antes da persistência atômica.
- Regras explícitas impedem backup e transferência de dados do aplicativo.
- Não declarar tráfego HTTP globalmente no APK de produção.

## Dashboard online opcional

### Desenvolvimento por USB

No APK debug, `http://localhost:3000` só alcança o computador com `adb reverse`. Desconectar o cabo ou reiniciar o tablet pode apagar esse encaminhamento e causar `ERR_HTTP_RESPONSE_CODE_FAILURE` no dashboard. Com o servidor local ligado, mantenha outro terminal aberto na raiz:

```powershell
npm run tablet:usb -- --serial SERIAL_DO_TABLET
```

O monitor verifica a conexão a cada 10 segundos e restaura apenas `tcp:3000 → tcp:3000` para esse tablet. Use `--port 3030` se o app e o servidor usarem essa outra porta. Ele não inicia o servidor, não muda credenciais, não reinicia o app e não expõe o painel na rede; o aplicativo tenta carregar novamente após a conexão voltar. Encerre com Ctrl+C. O cabo continua necessário. Instalação sem USB exige um endereço HTTPS alcançável pelo tablet e autenticação adequada, não `localhost`.

### Ativação

O modo Foto offline continua sendo o padrão, inclusive em instalações já pareadas. Para ativar o novo dashboard, primeiro pareie o tablet normalmente; depois abra o botão `⋮` e escolha **Usar dashboard online**. No mesmo menu, **Usar player offline** volta ao renderizador local e ao último conteúdo salvo. A escolha é persistida; desconectar ou revogar a credencial volta ao modo offline. O pareamento e a sincronização do conteúdo antigo continuam independentes do dashboard.

O servidor configurado no pareamento deve publicar `/player-dashboard/index.html`, `GET /api/player/config` e as fotos em `/api/player/online-photos/`. A URL explícita evita o redirecionamento 308 de `/player-dashboard/`, que o proxy não segue. O dispositivo precisa estar autorizado para a residência configurada no servidor (`SMARTFRAME_ONLINE_HOUSEHOLD_ID`). Se a configuração retornar 401/403 ou não estiver publicada, verifique o pareamento, a residência e o backend; o app não remove essas verificações nem cria sessão de administrador. O modo online depende da rede e não promete funcionar após reiniciar sem conexão.

Se o HTML inicial ou algum JS/CSS do dashboard falhar, o app tenta novamente após 2, 4, 8, 16, 32 e 60 segundos; enquanto a falha persistir, continua tentando a cada 60 segundos. Esses downloads têm prazo total nativo de 30 segundos, inclusive para cabeçalhos e respostas lentas; também são rejeitados conteúdo grande demais e MIME incompatível. Um watchdog de 60 segundos detecta navegação travada ou callbacks ausentes. As tentativas e o watchdog são cancelados durante a pausa, ao trocar de modo ou destruir a tela; ao retomar, o watchdog recomeça se ainda houver carregamento, e só se agenda retry em caso de falha. Cada tentativa usa uma nova WebView, isolando respostas tardias. Após falha, o intervalo só reinicia quando o HTML e os arquivos JS/CSS esperados tiverem carregado e a página permanecer estável por 60 segundos; manter essa lista nativa sincronizada com o HTML quando ele mudar. Falhas de `/api/player/config` e fotos não recarregam a página: o JavaScript trata sua própria recuperação. Isso verifica downloads, não a execução correta do JavaScript ou a apresentação visual.

Todos os downloads online usam prazo total nativo: 30 segundos para HTML e recursos, 9 segundos para configuração e 7,5 segundos para fotos, antes dos respectivos watchdogs JavaScript. Ao expirar, a operação é interrompida e sua conexão é desconectada; respostas tardias não executam callbacks na página. O trabalho fica isolado em até 16 threads daemon. Se a implementação de rede demorar a liberar todas essas threads, novos downloads falham imediatamente até haver capacidade. Falhas de configuração e fotos permanecem separadas da recuperação dos recursos críticos e não provocam recarga do dashboard.

As fotos online JPEG, PNG e WebP têm seus cabeçalhos inspecionados nativamente antes da entrega à WebView, sem decodificar os pixels. Cada imagem deve ter dimensões positivas de até 4096 por eixo e no máximo 2.097.152 pixels, além do limite de 16 MiB transferidos; o formato detectado deve corresponder ao Content-Type. O teto considera que o carrossel pode manter duas imagens decodificadas ao mesmo tempo em uma tela 1024×600. Fotos maiores são rejeitadas, não redimensionadas; o backend deverá fornecer versões adequadas separadamente.

**Limitação de estado:** a sincronização do player offline continua enquanto o dashboard online está ativo. O heartbeat existente confirma uma revisão somente depois que o renderizador offline a aplicou; entretanto, uma confirmação anterior do offline pode permanecer como `appliedRevision` no servidor. Assim, o painel pode interpretar essa revisão como se descrevesse o estado atual do dashboard online, embora ela não comprove que o dashboard carregou, recebeu a configuração ou exibiu esse conteúdo. Não há confirmação de revisão online neste protocolo; não use esse campo sozinho como prova do estado online.

O WebView online é recriado na troca de modo e não recebe ponte JavaScript, token, cookies de autenticação nem cabeçalhos das requisições nativas. A camada Kotlin intercepta os GETs, limita-os à origem pareada e aos caminhos do dashboard, configuração e fotos, não segue redirecionamentos e envia o token apenas às duas rotas de leitura protegidas. Outras navegações, origens, métodos e caminhos são bloqueados. O conteúdo online não acessa as fotos locais do modo offline. HTTPS é obrigatório em produção; HTTP continua restrito aos hosts `localhost`, `127.0.0.1` e `10.0.2.2` no APK debug. Isso não libera HTTPS com certificado inválido. O dashboard remoto e o servidor pareado devem ser confiáveis, pois a página autorizada pode ler a configuração e fotos acessíveis ao dispositivo.

O build e os testes de instrumentação não substituem validação no tablet: verifique a versão instalada do Android System WebView e teste o dashboard, os tamanhos de tela, interrupção de rede, autorização negada, troca de modos e retorno ao conteúdo offline no aparelho.

## Validação

O APK foi compilado e executado no PRITOM P7 em 30/10/2026. Foram verificados pareamento, foto publicada, confirmação da revisão, relógio, publicação remota e reabertura offline. Consulte [a validação da personalização](../../docs/PERSONALIZATION.md) e o [registro histórico do protótipo 0.1](../../docs/ANDROID-VALIDATION.md).

O teste contínuo de 72 horas, carrossel de 100 fotos e comportamento no boot permanecem pendentes.
