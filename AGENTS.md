# Orientações para agentes — SmartFrame

## Contexto

- Monorepo npm: `apps/web` (Next.js), `apps/worker`, `packages/*` (contratos, banco, autenticação, jobs, frames e widgets), `smartframe-player` (dashboard web) e `apps/android` (Kotlin/WebView).
- O fluxo principal v0.4 usa painéis publicados por dispositivo e player online. `packages/player` e APIs de manifesto/heartbeat são legado ou compatibilidade; não presumir que o APK atual funcione offline.
- Prefira o código atual e `docs/API.md`, `smartframe-player/README.md` e `apps/android/README.md` ao histórico. A documentação contém informações históricas e até divergências; confira implementação e migrations antes de afirmar comportamento.
- Leia as instruções de `apps/web/AGENTS.md` antes de trabalhar nessa área. Para código Next.js, consulte o guia pertinente em `node_modules/next/dist/docs/`, conforme esse arquivo.

## Segurança e alterações

- Preserve trabalho preexistente: confira `git status` antes de editar e não reverta alterações de terceiros.
- Não leia nem divulgue `.env`, credenciais, chaves, dados reais, banco ou mídia sem necessidade e autorização. Não remova volumes, `.data`, pareamentos ou instalações Android.
- ID de dispositivo não é credencial. Preserve autenticação, isolamento por conta/dispositivo, validação de origem, tokens fora do JavaScript e restrições de HTTPS; teste também acesso negado.
- Não aplique migrations em banco real, não execute deploy, instalação de APK, setup ou comandos destrutivos sem autorização explícita. Planeje backup consistente e parada dos processos quando necessário.
- Edite fontes, não diretórios gerados/ignorados. `npm run player:sync` copia `smartframe-player` e `packages/player/src` para `apps/web/public/`; não implica empacotar o dashboard no APK.

## Verificação

- Requisitos: Node 24 e npm 11+. Escolha testes proporcionais à mudança e informe o que foi ou não executado.
- `npm run check`: lint, typecheck, Vitest e testes do player. Vitest cria banco e mídia isolados em `.data` e executa migrations nesse banco de teste.
- `npm run test:player` cobre o player; testes visuais dependem de Chrome/Chromium. `npm run build` sincroniza assets e gera Prisma Client. Smoke HTTP requer build anterior.
- Para Android, consulte `apps/android/README.md` e `.github/workflows/android.yml`; build e testes automatizados não substituem teste em aparelho físico.
