import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { isInternalTestRule } from '@voltex/shared';
import { CatalogController } from '../../catalog/catalog.controller';
import { RulesController } from '../../rules/rules.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { AiController } from '../ai.controller';
import { iso, limitParam } from './tool-helpers';
import { defineTool, type AiToolDefinition, type AiToolSet } from './tool';

/** Termos do sistema, explicados por texto fixo: a IA não explica de memória o que o sistema chama de "margem real". */
export const GLOSSARY: Record<string, string> = {
  'margem real':
    'Margem do projeto com o que de fato entrou e saiu: valor recebido (parcelas pagas) menos custos realizados menos comissões. É diferente da margem prevista na cotação.',
  'margem prevista':
    'Margem calculada na cotação, antes da obra, com os custos e as taxas informados. É comparada com a margem mínima da política da empresa.',
  inadimplencia:
    'Parcelas vencidas e ainda não pagas. Parcela aberta com vencimento passado já conta como vencida.',
  'ciclo de venda': 'Dias entre a criação da oportunidade e a assinatura do contrato.',
  'taxa de ganho':
    'Oportunidades ganhas divididas pelas encerradas (ganhas mais perdidas). Só aparece com amostra mínima.',
  'oportunidade parada':
    'Oportunidade aberta sem tarefa aberta, ou há muitos dias na mesma etapa (o limite é da empresa).',
  sla: 'Prazo para o primeiro contato com um lead novo. Estourado quando passa do prazo sem contato.',
  semaforo:
    'Resultado da triagem de viabilidade: verde segue, amarelo pede olhar técnico, vermelho bloqueia proposta definitiva.',
  carteira:
    'Os registros em nome de um vendedor. O vendedor só enxerga a própria carteira; a gestão enxerga todas.',
  projeto:
    'Registro criado quando o contrato é assinado: acompanha a homologação e depois a instalação.',
  homologacao:
    'Aprovação do projeto pela distribuidora de energia, com documentos, protocolo e vistoria.',
  comissionamento:
    'Ensaios e conferências feitos após a instalação para liberar a usina. Quem aprova é o responsável técnico, pela regra ativa da empresa.',
  'aceite do cliente':
    'Confirmação do cliente (no local, no escritório ou pelo portal) de que recebeu o sistema instalado.',
  usina:
    'A instalação em operação, criada depois do aceite, com equipamentos, garantias, chamados e monitoramento.',
  'geracao esperada':
    'Geração mensal prevista no projeto técnico aprovado. Sem projeto técnico, não há geração esperada.',
  'desempenho da usina': 'Geração real dividida pela esperada no mesmo período.',
  chamado:
    'Pedido de atendimento de pós-venda de uma usina: corretivo, preventivo ou pedido do cliente.',
  garantia: 'Cobertura do fabricante de cada equipamento, pelos termos que a empresa cadastra.',
  'o&m': 'Operação e manutenção: contrato recorrente com visitas e acompanhamento da usina.',
  'amostra minima':
    'Quantidade mínima de registros para uma análise ser confiável. Abaixo disso o sistema diz que não pode responder.',
  'melhores clientes':
    'Por padrão, os 20% de clientes com maior margem real recebida (a empresa pode mudar o critério).',
  neuron:
    'Unidade de custo do provedor de IA. O sistema limita o uso diário para manter o custo em zero.',
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Plataforma: catálogo técnico, regras ativas e glossário. */
@Injectable()
export class PlatformTools implements AiToolSet {
  constructor(private readonly prisma: PrismaService) {}

  private cache: AiToolDefinition[] | null = null;
  get tools(): readonly AiToolDefinition[] {
    return (this.cache ??= this.build());
  }

  private build(): AiToolDefinition[] {
    const db = () => this.prisma.db;
    return [
      defineTool({
        name: 'catalogo_buscar',
        area: 'catálogo técnico',
        description:
          'Busca equipamentos do catálogo da empresa (módulos, inversores…) por fabricante ou modelo, com a situação e o preço de lista mais recente de cada fornecedor.',
        permissions: ['platform.catalog.read'],
        mirrors: { controller: CatalogController, handler: 'list' },
        params: z.object({
          texto: z.string().trim().min(2).max(60).optional(),
          limit: limitParam(20),
        }),
        run: async (_ctx, p) => {
          const items = await db().equipmentItem.findMany({
            where: {
              retiredAt: null,
              ...(p.texto
                ? {
                    OR: [
                      { manufacturer: { contains: p.texto, mode: 'insensitive' } },
                      { model: { contains: p.texto, mode: 'insensitive' } },
                    ],
                  }
                : {}),
            },
            orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
            take: p.limit,
            select: {
              id: true,
              kind: true,
              manufacturer: true,
              model: true,
              status: true,
              referenceCostCents: true,
              inmetroStatus: true,
            },
          });
          const prices = await db().priceListItem.findMany({
            where: { equipmentId: { in: items.map((i) => i.id) } },
            orderBy: { validFrom: 'desc' },
            select: {
              equipmentId: true,
              supplier: true,
              priceCents: true,
              validFrom: true,
              validTo: true,
            },
          });
          return {
            count: items.length,
            itens: items.map((i) => ({
              tipo: i.kind,
              fabricante: i.manufacturer,
              modelo: i.model,
              situacao: i.status,
              referenceCostCents: i.referenceCostCents,
              inmetro: i.inmetroStatus,
              precos: prices
                .filter((x) => x.equipmentId === i.id)
                .slice(0, 3)
                .map((x) => ({
                  fornecedor: x.supplier,
                  priceCents: x.priceCents,
                  validoDesde: iso(x.validFrom),
                  validoAte: iso(x.validTo),
                })),
            })),
          };
        },
      }),

      defineTool({
        name: 'regras_ativas',
        area: 'regras da empresa',
        description:
          'Quais regras técnicas e de operação estão ativas na empresa (chave, versão, desde quando) e se são regras de teste interno, sem revisão de engenheiro.',
        permissions: ['platform.rule.read'],
        mirrors: { controller: RulesController, handler: 'list' },
        params: z.object({}),
        run: async () => {
          const rules = await db().ruleSet.findMany({
            where: { status: 'ACTIVE' },
            orderBy: { key: 'asc' },
            select: { key: true, version: true, validFrom: true, reviewedAt: true, sources: true },
          });
          return {
            count: rules.length,
            regras: rules.map((r) => ({
              chave: r.key,
              versao: r.version,
              ativaDesde: iso(r.reviewedAt ?? r.validFrom),
              testeInterno: isInternalTestRule(r),
            })),
          };
        },
      }),

      defineTool({
        name: 'glossario',
        area: 'glossário',
        description:
          'Explica um termo do sistema com o texto oficial (ex.: margem real, inadimplência, taxa de ganho, carteira). Sem termo, lista os termos disponíveis.',
        permissions: ['ai.assistant.use'],
        mirrors: { controller: AiController, handler: 'status' },
        params: z.object({ termo: z.string().trim().min(2).max(60).optional() }),
        run: async (_ctx, p) => {
          if (!p.termo) return { termos: Object.keys(GLOSSARY).sort() };
          const wanted = fold(p.termo);
          const hit =
            Object.entries(GLOSSARY).find(([k]) => fold(k) === wanted) ??
            Object.entries(GLOSSARY).find(
              ([k]) => fold(k).includes(wanted) || wanted.includes(fold(k)),
            );
          return hit
            ? { termo: hit[0], significado: hit[1] }
            : {
                termo: p.termo,
                significado: null,
                aviso: 'Termo não está no glossário do sistema.',
              };
        },
      }),
    ];
  }
}
