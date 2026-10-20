import type {
  EquipmentKind,
  EquipmentOrigin,
  EquipmentSpec,
  EquipmentStatus,
  FieldConfidence,
  InmetroStatus,
} from '../schemas/equipment.js';

export interface SpecIssue {
  /** Código estável (ex.: `VMPP_NOT_BELOW_VOC`). */
  code: string;
  severity: 'ERROR' | 'WARNING';
  field: string;
  message: string;
}

export interface EquipmentDto {
  id: string;
  kind: EquipmentKind;
  manufacturer: string;
  model: string;
  spec: EquipmentSpec;
  origin: EquipmentOrigin;
  fieldConfidence: Record<string, FieldConfidence>;
  referenceCostCents: number | null;
  datasheetDocumentId: string | null;
  inmetroRegistration: string | null;
  inmetroStatus: InmetroStatus;
  inmetroCheckedAt: string | null;
  inmetroCheckedBy: string | null;
  status: EquipmentStatus;
  revision: number;
  supersedesId: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  retiredAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EquipmentDetailDto extends EquipmentDto {
  /** Conferência física dos valores (o que impede ou só avisa na aprovação). */
  issues: SpecIssue[];
  /** Outras revisões do mesmo modelo, da mais nova para a mais antiga. */
  revisions: Pick<EquipmentDto, 'id' | 'revision' | 'status' | 'approvedAt'>[];
}

export interface ImportCandidateDto {
  kind: EquipmentKind;
  manufacturer: string;
  model: string;
  spec: Record<string, unknown>;
  origin: EquipmentOrigin;
  fieldConfidence: Record<string, FieldConfidence>;
  issues: SpecIssue[];
  /** Custo de referência (centavos) vindo da planilha. */
  referenceCostCents?: number;
  /** `true` quando já existe um item com este fabricante e modelo (a importação criaria uma nova revisão em rascunho). */
  exists: boolean;
  /** Campos que o arquivo não trouxe e que a pessoa precisa preencher antes de aprovar. */
  missing: string[];
}

export interface ImportPreviewDto {
  format: string;
  candidates: ImportCandidateDto[];
  /** Erros por linha ou por arquivo (linha ilegível, formato desconhecido). */
  errors: { row?: number; message: string }[];
  /** O que o leitor assume e a pessoa precisa saber (ex.: unidades convertidas). */
  notes: string[];
}

export interface ExternalReferenceDto {
  id: string;
  kind: 'MODULE' | 'INVERTER';
  manufacturer: string;
  model: string;
  source: string;
  collectedAt: string;
  attribution: string;
  /** Campos já no formato do catálogo (parte pode faltar). */
  spec: Record<string, unknown>;
}

export interface PriceItemDto {
  id: string;
  equipmentId: string | null;
  description: string;
  supplier: string;
  sku: string | null;
  priceCents: number;
  validFrom: string;
  validTo: string | null;
  source: string;
  createdAt: string;
}

export interface PriceImportResultDto {
  rowsRead: number;
  created: number;
  /** Linhas cujo fabricante e modelo não existem (ou não estão aprovados) no catálogo. */
  unmatched: { row: number; manufacturer: string; model: string }[];
  errors: { row: number; message: string }[];
  dryRun: boolean;
}
