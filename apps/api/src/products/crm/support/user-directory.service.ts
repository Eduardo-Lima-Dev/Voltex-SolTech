import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../platform/prisma/prisma.service';

/** Nomes de usuários do tenant e validação de responsáveis (dono do lead, da oportunidade, da tarefa). */
@Injectable()
export class UserDirectory {
  constructor(private readonly prisma: PrismaService) {}

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
