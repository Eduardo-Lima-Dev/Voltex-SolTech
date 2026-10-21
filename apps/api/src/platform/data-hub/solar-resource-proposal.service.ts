import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ProposeSolarResourceInput, UpdateProposalDto } from '@voltex/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ClimateService } from './climate.service';
import { UpdateProposalsService, toProposalDto } from './update-proposals.service';

/**
 * Propõe o recurso solar (HSP mensal e temperaturas) de um local a partir da climatologia da NASA POWER. A proposta
 * entra na caixa de atualizações; só vira `SolarResource` da empresa quando uma pessoa aprova. As temperaturas seguem
 * como dado informativo: **não** são a temperatura de projeto do Voc frio.
 */
@Injectable()
export class SolarResourceProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly climate: ClimateService,
    private readonly proposals: UpdateProposalsService,
  ) {}

  async propose(input: ProposeSolarResourceInput): Promise<UpdateProposalDto> {
    const weather = await this.climate.weather({
      latitude: input.latitude,
      longitude: input.longitude,
      source: 'nasa-power',
      kind: 'climatology',
      ...(input.refresh ? { refresh: true } : {}),
    });
    const hsp = weather.summary.ghiKwhM2Day;
    if (hsp.length !== 12 || hsp.some((v) => v === null))
      throw new ConflictException('A fonte não devolveu os 12 meses de irradiação');
    const hspMonthly = hsp as number[];
    const average = hspMonthly.reduce((a, b) => a + b, 0) / 12;
    const existing = await this.prisma.db.solarResource.findFirst({
      where: { name: input.name, state: input.state ?? null, deletedAt: null },
    });
    const hash = createHash('sha256').update(JSON.stringify(hspMonthly)).digest('hex');
    const row = await this.proposals.create({
      type: 'SOLAR_RESOURCE',
      title: `Irradiação de ${input.name}${input.state ? `/${input.state}` : ''}: HSP médio ${average.toFixed(2)} kWh/m²·dia (NASA POWER)`,
      target: { existingId: existing?.id ?? null },
      proposed: {
        name: input.name,
        state: input.state ?? null,
        latitude: weather.latitude,
        longitude: weather.longitude,
        hspMonthly,
        plane: 'Plano horizontal',
        source: `NASA POWER, climatologia mensal da grade de ${weather.latitude}, ${weather.longitude} (coletada em ${weather.fetchedAt.slice(0, 10)}). ${weather.attribution}`,
        temperatures: {
          meanC: weather.summary.tempMeanC,
          minC: weather.summary.tempMinC,
          maxC: weather.summary.tempMaxC,
          source: 'NASA POWER',
          note: 'Climatologia da fonte: não é a temperatura de projeto.',
        },
      },
      diff: existing ? { previousHspMonthly: existing.hspMonthly } : null,
      origin: {
        source: 'nasa-power',
        collectedAt: weather.fetchedAt,
        contentHash: hash,
        license: weather.license,
        attribution: weather.attribution,
      },
      dedupeKey: `solar:${input.name}:${input.state ?? ''}:${hash}`,
    });
    if (!row) throw new ConflictException('Já existe uma proposta igual para este local');
    return toProposalDto(row);
  }
}
