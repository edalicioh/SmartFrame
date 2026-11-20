---
name: smartframe-dados
description: Use para alterações no Prisma, SQLite, migrations, worker, mídia, backup ou persistência de pareamento do SmartFrame.
---

# Dados e worker

1. Leia `packages/database/prisma/schema.prisma`, migrations relevantes, `docs/OPERATIONS.md` e código envolvido. Confira o estado real antes de propor migration; nem toda alteração exige schema novo.
2. Preserve contas, mídia, publicação e pareamentos. Nunca execute migration em banco real, deploy, exclusão de volumes ou restauração sem autorização explícita. Oriente backup consistente de SQLite e mídia e proteção separada de `.env`; processos podem precisar ser parados.
3. Em jobs, considere processamento pelo menos uma vez, idempotência, leases e retentativas; consulte `packages/jobs/src/index.ts` antes de alterar comportamento.
4. Teste a alteração em banco isolado. `npm test` usa configuração de `vitest.config.ts` e `tests/global-setup.ts`; não confunda esse banco temporário com o banco de desenvolvimento.
5. Informe claramente o que foi testado e quais ações de migração ou operação ainda exigem aprovação.
