# ADR-0010: RustFS como S3 local no lugar do MinIO

- **Status:** Aceita
- **Data:** 2026-10-18

## Contexto

O plano previa MinIO como armazenamento S3-compatível de desenvolvimento. Ao subir a infra da Fase 3, a imagem `minio/minio` já não existe no Docker Hub e as imagens do `quay.io/minio` exigem autenticação, ou seja, deixaram de ser publicamente instaláveis.

## Decisão

Usar **RustFS** (`rustfs/rustfs`, S3-compatível, licença Apache-2.0, com console web) como serviço `s3` do Compose de desenvolvimento e homologação. O bucket é criado por um job único com `amazon/aws-cli` (`s3-init`). Em produção real usa-se S3 (ou compatível gerenciado). A aplicação só conhece variáveis `S3_*`, então trocar de provedor não exige mudança de código.

## Consequências

- Variáveis passam a ser `S3_API_PORT`, `S3_CONSOLE_PORT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` (sem prefixo `MINIO_`).
- A imagem é `latest`; fixar uma tag antes de produção.
- O `DocumentsModule` (Fase 4) deve usar `forcePathStyle` e poderá criar o bucket se ele não existir.

## Alternativas consideradas

Adobe S3Mock (emulador simples, menor fidelidade com S3); SeaweedFS (mais componentes para configurar); LocalStack (pesado para só usar S3).
