# SmartFrame Player Android — v0.4

O APK v0.4 é um cliente WebView fino para o dashboard online do dispositivo pareado.
O servidor fornece layout e fotos; o APK não usa o renderer offline legado, nem baixa
manifestos para um cache persistente. A tela exige conectividade com o servidor. As
rotas offline antigas podem continuar no servidor para compatibilidade, mas não são
o fluxo deste APK. Tela cheia imersiva não configura Android lock-task/kiosk.

## Build

No Windows, na raiz do monorepo:

```powershell
npm run android:setup -- -AcceptSdkLicenses
npm run android:build
```

O setup portátil instala JDK 21, Gradle/SDK em `.data/android-toolchain/`; build e
lint produzem `apps/android/app/build/outputs/apk/debug/app-debug.apk`. O setup exige
aceitar as licenças oficiais do Android SDK.

A CI Android executa build de debug, testes unitários e lint em pull requests e no
deploy da `main`, além de disponibilizar o APK como artefato. Para publicar o APK no
painel, o deploy exige uma chave de debug persistente e confere sua assinatura; veja
[DEPLOY-GITHUB-ACTIONS.md](../../docs/DEPLOY-GITHUB-ACTIONS.md). Builds de pull
request usam uma chave temporária e podem não atualizar a instalação existente. Não
desinstale o app para contornar incompatibilidade sem antes proteger seus dados.

## Atualização e preservação

Antes de atualizar uma instalação em uso, faça backup do diretório/volume `.data`
(incluindo banco SQLite e mídia) e preserve `.env` em local seguro. Atualização normal
não deve apagar dados, desvincular o tablet nem forçar novo pareamento. Não há cópia
silenciosa do conteúdo offline v0.3 para o novo layout online: entre no editor,
selecione o dispositivo, configure fotos/opções e publique intencionalmente. O APK
novo carrega apenas o dashboard online e precisa de rede para exibi-lo.

O APK debug usa assinatura de debug. Android só aceita atualização in-place se a
assinatura corresponder à instalação existente. Verifique origem/assinatura antes de
instalar; não desinstale para contornar incompatibilidade sem compreender que isso
pode apagar dados locais/credenciais. Builds de distribuição exigem a chave apropriada.

```powershell
adb devices -l
adb -s SERIAL_DO_TABLET install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

`install -r` não substitui um APK de assinatura incompatível. Não existe instalação
automática pelo processo de atualização do servidor.

## Rede e pareamento

O dispositivo deve estar pareado ao servidor e abrir seu player por dispositivo.
HTTPS com certificado confiável é obrigatório em produção. Para desenvolvimento por
USB, o endereço `http://localhost:3000` no APK só alcança o computador com o reverse
ADB ativo:

```powershell
adb -s SERIAL_DO_TABLET reverse tcp:3000 tcp:3000
```

O APK de debug deste ambiente também confia na CA pública em
`app/src/debug/res/raw/smartframe_local_ca.pem` exclusivamente para
`frame.home.arpa`. Outros endereços continuam usando as CAs do sistema; builds de
produção não incluem essa exceção. Trocar a CA local exige atualizar o certificado
público e reconstruir o APK. Nunca inclua a chave privada da CA no aplicativo.

Mantenha cabo e encaminhamento ativos; se tablet e servidor estiverem em LAN, use o
hostname/IP alcançável do servidor e HTTPS confiável — não use `localhost` do tablet.
HTTP é apenas para debug loopback, nunca para exposição à LAN/internet. Um ID de
dispositivo na URL não é credencial. A página no navegador comum não ganha acesso às
rotas Bearer; a credencial do APK fica na camada nativa, fora do JavaScript.

## Validação

Build/testes automatizados não comprovam operação em hardware. Validar no PRITOM e
registrar separadamente: instalação/assinatura, orientação e tamanho, inicialização,
WebView, conexão/reconexão, configuração publicada/aplicada, fotos, autorização
negada e estabilidade. Nenhuma validação real-device v0.4 é afirmada aqui.

O registro [ANDROID-VALIDATION.md](../../docs/ANDROID-VALIDATION.md) descreve apenas
um protótipo antigo; seus resultados não validam este APK online.
