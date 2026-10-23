import {
  BatteryCharging,
  Calculator,
  CircuitBoard,
  Handshake,
  HardHat,
  type LucideIcon,
} from 'lucide-react';
import { Product, type Permission } from '@voltex/shared';
import { PRODUCT_LABELS } from '@/i18n/labels';

export interface ProductDef {
  id: Product;
  name: string;
  path: string;
  icon: LucideIcon;
  tagline: string;
  /** Permissão mínima para acessar o produto. */
  permission: Permission;
  /** Fase do plano em que o produto passa a funcionar. */
  availability: { status: 'available' } | { status: 'soon'; phase: string };
  highlights: string[];
}

/** Os quatro produtos da suíte. Hoje só a casca existe; cada produto ganha suas telas nas fases indicadas. */
export const PRODUCTS: readonly ProductDef[] = [
  {
    id: Product.CRM,
    name: PRODUCT_LABELS.CRM,
    path: '/crm',
    icon: Handshake,
    tagline: 'Do lead à proposta, com margem protegida.',
    permission: 'crm.lead.read',
    availability: { status: 'available' },
    highlights: [
      'Leads, funil e tarefas',
      'Fatura de energia com leitura assistida',
      'Cotação com controle de margem',
      'Proposta, contrato e projeto',
    ],
  },
  {
    id: Product.CALCULATOR,
    name: PRODUCT_LABELS.CALCULATOR,
    path: '/calculator',
    icon: Calculator,
    tagline: 'Pré-viabilidade solar em minutos.',
    permission: 'calculator.session.read',
    availability: { status: 'available' },
    highlights: [
      'Potência, geração e economia',
      'Payback e fluxo de caixa',
      'Semáforo de pré-viabilidade',
      'Snapshot imutável do cálculo',
    ],
  },
  {
    id: Product.ENGINE,
    name: PRODUCT_LABELS.ENGINE,
    path: '/engine',
    icon: CircuitBoard,
    tagline: 'Projeto e validação técnica fotovoltaica.',
    permission: 'engine.project.read',
    availability: { status: 'available' },
    highlights: [
      'Catálogo de módulos e inversores',
      'Strings, MPPT e compatibilidade',
      'Proteções, cabos e simulação',
      'Relatórios e aprovação técnica',
    ],
  },
  {
    id: Product.OFFGRID,
    name: PRODUCT_LABELS.OFFGRID,
    path: '/offgrid',
    icon: BatteryCharging,
    tagline: 'Sistemas isolados e com armazenamento.',
    permission: 'offgrid.project.read',
    availability: { status: 'available' },
    highlights: [
      'Cargas, perfil de consumo e partida de motores',
      'Autonomia, banco de baterias e simulação horária',
      'Controlador, inversor, gerador e rede (híbrido sem injeção)',
      'Cenários, custo e aprovação técnica',
    ],
  },
  {
    id: Product.OPERATIONS,
    name: PRODUCT_LABELS.OPERATIONS,
    path: '/operations',
    icon: HardHat,
    tagline: 'Da obra homologada à planta entregue.',
    permission: 'ops.installation.read',
    availability: { status: 'available' },
    highlights: [
      'Instalação com materiais, compras e recebimento',
      'Equipes, agenda e ordens de serviço',
      'Pendências de campo e histórico',
      'Painel de execução da operação',
    ],
  },
];

export const productById = (id: Product): ProductDef => {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) throw new Error(`Produto desconhecido: ${id}`);
  return product;
};
