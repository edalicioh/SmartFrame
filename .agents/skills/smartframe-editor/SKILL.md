---
name: smartframe-editor
description: Use ao implementar ou revisar editor de painéis, publicação, APIs administrativas, contratos ou widgets do SmartFrame, inclusive prévia e autorização por dispositivo.
---

# Editor e contratos

1. Leia `AGENTS.md`, `apps/web/AGENTS.md`, `docs/API.md` e os arquivos efetivamente envolvidos. Para alterações Next.js consulte a documentação local indicada em `apps/web/AGENTS.md`.
2. Trace dados entre `apps/web/src/components/`, `apps/web/src/app/api/`, `apps/web/src/lib/`, `packages/contracts/src/` e o player. Confira o código antes de alterar defaults, esquema Zod ou compatibilidade.
3. Preserve separação entre rascunho, publicação e revisão aplicada; confira concorrência por revisão e isolamento de conta e dispositivo. Prévia administrativa não deve receber credencial Bearer.
4. Para widgets, examine `packages/widgets/src/`, renderização no player e testes. Não confie em texto ou URL externa; mantenha as validações existentes.
5. Adicione testes de contrato, editor e rotas em `tests/` conforme o impacto, incluindo falhas e acessos não autorizados. Use a skill `smartframe-validacao` para escolher comandos.
