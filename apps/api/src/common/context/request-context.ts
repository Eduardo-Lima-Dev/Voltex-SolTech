import { Injectable } from '@nestjs/common';
import { ClsService, type ClsStore } from 'nestjs-cls';
import type { Role } from '@voltex/shared';

export interface RequestStore extends ClsStore {
  tenantId?: string;
  userId?: string;
  role?: Role;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  /** Liga só nas consultas de duplicidade, que precisam enxergar além da carteira (sem devolver o dado ao usuário). */
  ownershipBypass?: boolean;
}

/** Contexto da requisição corrente (AsyncLocalStorage via nestjs-cls). Alimenta tenant, auditoria e logs. */
@Injectable()
export class RequestContext {
  constructor(private readonly cls: ClsService<RequestStore>) {}

  get tenantId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('tenantId') : undefined;
  }
  get userId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('userId') : undefined;
  }
  get role(): Role | undefined {
    return this.cls.isActive() ? this.cls.get('role') : undefined;
  }
  get requestId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('requestId') : undefined;
  }
  get ip(): string | undefined {
    return this.cls.isActive() ? this.cls.get('ip') : undefined;
  }
  get userAgent(): string | undefined {
    return this.cls.isActive() ? this.cls.get('userAgent') : undefined;
  }

  get ownershipBypass(): boolean {
    return this.cls.isActive() ? this.cls.get('ownershipBypass') === true : false;
  }

  /**
   * Roda `fn` sem o filtro de carteira (ADR-0028). Só para checar se algo já existe na empresa (duplicidade);
   * quem usa não pode devolver ao usuário o registro que está fora da carteira dele.
   */
  async withoutOwnership<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.cls.isActive()) return fn();
    this.cls.set('ownershipBypass', true);
    try {
      return await fn();
    } finally {
      this.cls.set('ownershipBypass', false);
    }
  }

  set(values: Partial<RequestStore>): void {
    if (!this.cls.isActive()) return;
    for (const [key, value] of Object.entries(values)) {
      this.cls.set(key as keyof RequestStore, value as never);
    }
  }

  /** Tenant da requisição; falha de forma explícita se não houver (nunca assume um padrão). */
  requireTenantId(): string {
    const tenantId = this.tenantId;
    if (!tenantId) throw new Error('Contexto de tenant ausente nesta operação');
    return tenantId;
  }

  /** Executa `fn` com um tenant definido (workers, testes). */
  run<T>(values: Partial<RequestStore>, fn: () => Promise<T>): Promise<T> {
    return this.cls.run(async () => {
      this.set(values);
      return fn();
    });
  }
}
