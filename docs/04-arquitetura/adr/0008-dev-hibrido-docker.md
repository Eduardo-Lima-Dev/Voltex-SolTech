# ADR-0008: Desenvolvimento híbrido: infra no Docker, apps locais

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

Queremos um único comando para subir tudo, com hot reload rápido, e imagens Docker para build e produção.

## Decisão

`pnpm dev` sobe PostgreSQL, Redis, um armazenamento S3-compatível (RustFS, ver [ADR-0010](0010-rustfs-no-lugar-do-minio.md)) e Mailpit via Docker Compose (`docker/compose.dev.yml`) e roda API e Web localmente pelo Turborepo. Um Compose separado (`docker/compose.prod.yml`) builda e executa tudo em containers.

## Consequências

Hot reload rápido e depuração simples; ambiente de dados idêntico em qualquer máquina. Há duas rotas de execução a manter (dev e prod).

## Alternativas consideradas

Tudo dentro do Docker também em dev (hot reload mais lento, atrito com node_modules).
