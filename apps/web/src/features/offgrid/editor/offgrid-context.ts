import { createContext, useContext } from 'react';
import type {
  EquipmentDto,
  OffgridDesign,
  OffgridResults,
  OffgridVersionDetailDto,
} from '@voltex/shared';

export interface OffgridEditorValue {
  version: OffgridVersionDetailDto;
  design: OffgridDesign;
  update: (fn: (design: OffgridDesign) => OffgridDesign) => void;
  readOnly: boolean;
  /** Resultados: prévia no navegador enquanto edita; os oficiais do servidor depois de salvar. */
  results: OffgridResults;
  /** Nome legível de um equipamento do catálogo (ou "Nenhum"). */
  labelOf: (id: string | undefined) => string;
  /** Equipamentos aprovados, por tipo, para escolha. */
  approved: Record<string, EquipmentDto[]>;
  goToStep: (id: string) => void;
}

export const OffgridEditorContext = createContext<OffgridEditorValue | null>(null);

export function useOffgrid(): OffgridEditorValue {
  const ctx = useContext(OffgridEditorContext);
  if (!ctx) throw new Error('useOffgrid fora do OffgridEditorContext');
  return ctx;
}
