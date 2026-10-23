import type {
  AssetCategory,
  MaintenanceKind,
  TicketPriority,
  TicketStatus,
  TicketType,
  WarrantyKind,
} from '@voltex/shared';

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  MODULE: 'Módulo',
  INVERTER: 'Inversor',
  BATTERY: 'Bateria',
  PROTECTION: 'Proteção',
  CABLE: 'Cabeamento',
  OTHER: 'Outro',
};

export const WARRANTY_KIND_LABELS: Record<WarrantyKind, string> = {
  PRODUCT: 'Produto',
  PERFORMANCE: 'Desempenho',
};

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  CORRECTIVE: 'Corretivo',
  PREVENTIVE: 'Preventivo',
  REQUEST: 'Pedido do cliente',
  PERFORMANCE_ALERT: 'Alerta de desempenho',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: 'Baixa',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em andamento',
  WAITING_CUSTOMER: 'Aguardando o cliente',
  RESOLVED: 'Resolvido',
  CLOSED: 'Encerrado',
};

export const TICKET_STATUS_VARIANT: Record<
  TicketStatus,
  'green' | 'yellow' | 'red' | 'secondary' | 'outline'
> = {
  OPEN: 'yellow',
  IN_PROGRESS: 'secondary',
  WAITING_CUSTOMER: 'outline',
  RESOLVED: 'green',
  CLOSED: 'outline',
};

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  PREVENTIVE: 'Preventiva',
  CLEANING: 'Limpeza',
  INSPECTION: 'Inspeção',
};

/** Data de calendário `AAAA-MM-DD` (ou ISO) em `DD/MM/AAAA`, sem passar pelo fuso do navegador. */
export const formatDay = (value: string): string => {
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const daysLeftLabel = (days: number): string =>
  days < 0 ? `vencida há ${-days} dia(s)` : days === 0 ? 'vence hoje' : `${days} dia(s)`;
