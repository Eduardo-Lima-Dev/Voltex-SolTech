# Modelo de entidades da plataforma

Modelo **físico** atual (`packages/database/prisma/schema/platform.prisma`). Todos os modelos, exceto `Tenant`, carregam `tenantId` ([ADR-0005](../../04-arquitetura/adr/0005-multi-tenancy.md)).

```mermaid
erDiagram
    TENANT ||--o{ BRANCH : possui
    TENANT ||--o{ TEAM : possui
    TENANT ||--o{ USER : possui
    BRANCH ||--o{ TEAM : agrupa
    BRANCH ||--o{ USER : aloca
    TEAM ||--o{ USER : reune
    USER ||--o{ REFRESH_TOKEN : emite
    TENANT ||--o{ AUDIT_LOG : registra
    TENANT ||--o{ OUTBOX_EVENT : publica

    TENANT {
        uuid id PK
        string slug UK
        string name
        enum status
        json settings
    }
    USER {
        uuid id PK
        uuid tenantId FK
        string email UK
        string passwordHash
        enum role
        bool isActive
        bool mfaEnabled
    }
    REFRESH_TOKEN {
        uuid id PK
        string tokenHash UK
        uuid familyId
        datetime expiresAt
        datetime revokedAt
    }
    AUDIT_LOG {
        uuid id PK
        string action
        string entity
        json before
        json after
        string requestId
    }
    OUTBOX_EVENT {
        uuid id PK
        string type
        string projectCode
        json payload
        datetime publishedAt
        int attempts
    }
```

- `AUDIT_LOG` é imutável (trigger no banco).
- `OUTBOX_EVENT` é gravado na mesma transação do dado de negócio e entregue por um worker ([eventos](../../04-arquitetura/eventos.md)).
- `REFRESH_TOKEN` guarda só o hash; `familyId` permite revogar a cadeia inteira se um token já usado reaparecer.
