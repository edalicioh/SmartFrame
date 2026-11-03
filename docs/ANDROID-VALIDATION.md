# Validação Android — protótipo 0.1.0

Registro **histórico do protótipo 0.1.0**, realizado em **30/10/2026**. O modo Foto 0.2 acrescentou pareamento, foto e sincronização; consulte [a validação atual](PERSONALIZATION.md). Os hashes e a ausência de permissão de internet abaixo se referem somente ao APK antigo. Este registro não substitui os critérios de aceite do MVP ou o teste contínuo de 72 horas.

## Ambiente

- Hardware real: PRITOM P7_A1 / modelo P7, Android 11, API 30.
- ABI informada pelo dispositivo: `armeabi-v7a,armeabi` (32 bits).
- Android System WebView: `150.0.7871.181`.
- Janela validada em paisagem: 1024 × 600.
- Ferramentas locais: Temurin JDK 21.0.13+9, Gradle 8.13, AGP 8.13.2, Kotlin 2.2.21, SDK 36 e Build Tools 35.0.0.
- Aplicativo: `com.smartframe.player`, minSdk 26, targetSdk 36, bytecode Java 17.

## Artefato

- Caminho: `apps/android/app/build/outputs/apk/debug/app-debug.apk`.
- Tamanho: 1.305.538 bytes, aproximadamente 1,25 MiB.
- SHA-256: `f156e72e05c77811d7f5e23fb16a915e8a49a996f3b49a272f6f485905aeb11b`.
- Assinatura de debug verificada pelo `apksigner`, esquema v2.
- Wrapper Gradle gerado pela distribuição oficial; SHA-256 do JAR conferido com o publicado pelo Gradle.

Este hash identifica o artefato desta execução. Um novo build ou outra chave de debug pode produzir um APK diferente. A assinatura de distribuição ainda não foi configurada.

## Verificações aprovadas

1. `assembleDebug` e `lintDebug` concluídos sem erros.
2. Instalação por USB, sem substituir aplicativo preexistente.
3. Abertura da Activity e renderização do HTML/CSS/JavaScript embarcado.
4. Área útil de 1024 × 600, sem barras do sistema na captura e sem overflow horizontal.
5. Relógio preenchido no formato HH:mm, com atualização do atributo de tempo observada em amostras separadas por 1,4 segundo.
6. Acesso de rede do renderizador bloqueado pela CSP; o manifesto do protótipo não solicita permissão de internet.
7. Encerramento explícito apenas do processo SmartFrame e nova abertura bem-sucedida.
8. Nenhuma falha registrada no buffer de crashes para o processo inicial durante essa verificação.

O `am start -W` informou 2.957 ms na primeira abertura e 1.591 ms na reabertura. Esses números medem a inicialização da Activity e não constituem um benchmark completo do conteúdo renderizado.

A amostra inicial do **processo principal** registrou 56.597 KiB de PSS (aproximadamente 55 MiB). Ela **não inclui necessariamente o processo isolado do renderizador WebView** e não mede crescimento de memória ao longo do tempo.

## Avisos e limites

- O lint emitiu quatro avisos não bloqueantes: atualização disponível do Gradle, atualização disponível do AndroidX WebKit, ausência de regras explícitas de extração de dados no Android 12+ e ausência de ícone próprio.
- O build também informou a depreciação do DSL Kotlin `jvmTarget` e uma diferença entre versões do formato de metadados do SDK. A compilação foi concluída; revisar essas configurações antes do release.
- A política atual declara `allowBackup=false`; regras explícitas de transferência entre dispositivos devem ser acrescentadas antes de armazenar credenciais e conteúdo sensível no aplicativo.
- Não foram validados: execução por 72 horas, orientação retrato, inicialização no boot, instalação de release ou comportamento em outros tablets/WebViews.
- Fotos, carrossel, pareamento, cache de mídias, atualização atômica e sincronização ainda não estão implementados.
- O teste não desligou Wi-Fi ou dados do usuário. A independência da tela inicial foi verificada pelo conteúdo embarcado, ausência de permissão de internet e bloqueio da rede no renderizador.
