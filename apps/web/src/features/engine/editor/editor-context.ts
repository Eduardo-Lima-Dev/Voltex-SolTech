import { createContext, useContext } from 'react';
import type {
  EngineeringDesign,
  EngineeringResults,
  EngineeringVersionDetailDto,
  EquipmentDto,
} from '@voltex/shared';

export interface EditorContextValue {
  version: EngineeringVersionDetailDto;
  design: EngineeringDesign;
  /** Atualiza o desenho (função pura sobre o desenho atual). */
  update: (fn: (design: EngineeringDesign) => EngineeringDesign) => void;
  /** Só rascunho edita. */
  readOnly: boolean;
  /** Resultados calculados no navegador sobre o desenho atual (a versão salva vem do servidor). */
  results: EngineeringResults;
  /** Módulos aprovados do catálogo, para escolha. */
  modules: EquipmentDto[];
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor fora do EditorContext');
  return ctx;
}

/** Módulo escolhido (da superfície ou o padrão do projeto) com nome legível. */
export const moduleLabel = (modules: EquipmentDto[], id: string | undefined): string => {
  const m = modules.find((x) => x.id === id);
  return m ? `${m.manufacturer} ${m.model}` : 'Nenhum';
};
