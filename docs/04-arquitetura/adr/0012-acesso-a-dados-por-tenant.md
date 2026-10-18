# ADR-0012: Acesso a dados escopado por tenant com falha fechada

- **Status:** Aceita (detalha a [ADR-0005](0005-multi-tenancy.md))
- **Data:** 2026-10-18

## Contexto

Um único `WHERE tenantId` esquecido vaza dados entre empresas. A ADR-0005 definiu `tenantId` em toda tabela; faltava o mecanismo que impede o esquecimento.

## Decisão

`PrismaService` expõe **duas portas**:

- `db`: cliente com extensão de query que injeta `tenantId` em todas as operações dos modelos de `TENANT_SCOPED_MODELS` e **falha** se não houver tenant no contexto. Recusa filtrar/criar em outro tenant, mover registro entre tenants e qualquer operação não prevista.
- `system`: cliente sem filtro, restrito a fluxos que acontecem **antes** de existir tenant (login, refresh, aceitar convite) ou fora de requisição (outbox).

O tenant vem do token validado, via `AsyncLocalStorage` (nestjs-cls), nunca de parâmetros do cliente. As regras vivem em uma função pura (`scopeArgs`) com testes unitários; os e2e tentam, como o tenant A, ler/alterar dados do B por todas as rotas.

## Política de perfis

OWNER gerencia todos os perfis; ADMIN gerencia todos, exceto OWNER; demais perfis não gerenciam usuários. Ninguém altera o próprio perfil nem se desativa/exclui, e o tenant mantém sempre ao menos um OWNER ativo (invariante defensiva).

## Consequências

- Código de negócio usa `db` por padrão; `system` exige justificativa em revisão.
- `$queryRaw` não é escopado: proibido em código de negócio.
- O tipo do Prisma ainda exige `tenantId` nos `create`; os services o passam explicitamente e a extensão confere.
- Row Level Security do PostgreSQL pode ser somada depois como segunda barreira.

## Alternativas consideradas

Filtro manual em cada query (propenso a erro); RLS apenas (exige `SET` por conexão, complicado com pool e driver adapter); schema por tenant (ver ADR-0005).
