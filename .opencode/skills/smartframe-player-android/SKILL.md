---
name: smartframe-player-android
description: Use para mudanças no dashboard smartframe-player, WebView Kotlin, pareamento, polling, rede, reconexão ou build do APK SmartFrame.
---

# Player e Android

1. Leia `smartframe-player/README.md`, `apps/android/README.md` e os arquivos afetados. O APK atual é um WebView do dashboard remoto; não confunda com `packages/player` legado ou com cópias web geradas por `scripts/sync-player.mjs`.
2. Mantenha token na camada nativa, fora de URLs, logs e JavaScript; ID não é credencial. Preserve HTTPS para produção e restrição de HTTP debug ao loopback.
3. Em mudanças de configuração, confira a publicação por dispositivo, polling e confirmação `appliedRevision`; confirmação não prova exibição de todos os pixels.
4. Teste falhas e retomada de rede, temporizadores e limpeza de recursos quando relevantes. Não prometa retomada offline após reiniciar.
5. Use `npm run test:player` para testes do dashboard; para Android consulte a CI em `.github/workflows/android.yml`. Não instale nem desinstale APK sem autorização; assinatura incompatível pode impedir atualização e desinstalar pode perder dados. Hardware real requer validação separada.
