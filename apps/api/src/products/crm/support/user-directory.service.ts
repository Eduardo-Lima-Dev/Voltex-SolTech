import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { RequestContext } from '../../../common/context/request-context';
import { PrismaService } from '../../../platform/prisma/prisma.service';

/** Nomes de usuários do tenant e validação de responsáveis (dono do lead, da oportunidade, da tarefa). */
@Injectable()
export class UserDirectory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContext,
  ) {}

  /**
   * O vendedor não passa registro para outra pessoa: o registro sairia da vista dele e ele poderia empurrar trabalho
   * para os outros. Redistribuir é da gestão. O SDR é quem distribui os leads, então pode passá-los (ADR-0028).
   */
  assertCanAssignPortfolio(ownerId: string | null | undefined): void {
    if (ownerId === undefined || ownerId === null) return;
    if (this.context.role !== 'SALESPERSON') return;
    if (ownerId !== this.context.userId)
      throw new ForbiddenException('Só a gestão pode passar um registro para outro responsável');
  }

  async names(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /** Garante que o usuário existe, está ativo e é do tenant (o filtro de tenant é automático). */
  async assertActive(id: string | null | undefined, label = 'responsável'): Promise<void> {
    if (!id) return;
    const user = await this.prisma.db.user.findFirst({
      where: { id, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!user)
      throw new UnprocessableEntityException(`O ${label} informado não existe ou está inativo`);
  }
}
