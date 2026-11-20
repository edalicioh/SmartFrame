---
name: smartframe-validacao
description: Use ao escolher ou executar testes, lint, typecheck, build ou revisão de regressão para alterações no projeto SmartFrame.
---

# Validação

1. Confira scripts em `package.json` e testes próximos da mudança. Na raiz, `npm run check` executa lint, typecheck, Vitest e testes do player; escolha também testes direcionados quando apropriado.
2. Vitest utiliza banco e mídia temporários em `.data` e aplica migrations nesse banco. `npm run test:player` executa testes Node; alguns testes visuais exigem Chrome/Chromium. Consulte os testes para identificar pré-requisitos e skips.
3. `npm run build` sincroniza assets para `apps/web/public` e gera Prisma Client. `npm run test:smoke` e `npm run test:smoke:local` exigem build prévio e iniciam servidor temporário.
4. A CI Android executa `assembleDebug testDebugUnitTest lintDebug`; confira `.github/workflows/android.yml` e disponibilidade do SDK antes de executar. Testes instrumentados e validação física são distintos.
5. Não execute setup, deploy, migrations reais ou operações em dispositivo sem autorização. Reporte comandos, resultados, falhas, skips e limitações sem alegar cobertura que não foi executada.
