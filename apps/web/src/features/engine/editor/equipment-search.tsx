import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CatalogSearchResultDto, EquipmentKind, ImportPreviewDto } from '@voltex/shared';
import { toast } from '@voltex/ui';
import { EquipmentSearchBox, fetchPreview } from '@/features/admin/catalog/equipment-search-box';
import { ImportDialog } from '@/features/admin/catalog/import-dialog';
import { queryKeys } from '@/features/admin/query-keys';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/**
 * Busca ao digitar no catálogo da empresa e nas fontes (públicas e cadastradas por link). Cada resultado mostra de onde
 * vem. Escolher o que já está aprovado usa direto; escolher o de uma fonte abre a prévia para importar (a pessoa completa o
 * que faltar) e, depois de aprovado, entra no projeto.
 */
export function EquipmentSearch({
  kind,
  label,
  disabled,
  onPick,
}: {
  kind: EquipmentKind;
  label: string;
  disabled?: boolean;
  /** Recebe o id do equipamento **aprovado** escolhido. */
  onPick: (equipmentId: string) => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);

  const choose = async (item: CatalogSearchResultDto) => {
    try {
      if (item.origin === 'CATALOG') {
        if (item.status === 'APPROVED') onPick(item.id);
        else if (can('engine.project.approve')) {
          setBusy(true);
          await endpoints.catalog.approve(item.id);
          await queryClient.invalidateQueries({ queryKey: queryKeys.catalog() });
          toast.success('Item aprovado e pronto para usar.');
          onPick(item.id);
        } else toast.info('Este item é um rascunho: peça a aprovação do responsável técnico.');
      } else {
        setBusy(true);
        setPreview(await fetchPreview(item, kind));
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível usar este item.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EquipmentSearchBox
        kind={kind}
        label={label}
        disabled={disabled}
        busy={busy}
        onChoose={(item) => void choose(item)}
      />
      {preview ? (
        <ImportDialog
          open
          onOpenChange={(next) => !next && setPreview(null)}
          defaultKind={kind}
          initialPreview={preview}
          onCreated={(created) => {
            const ready = created.find((c) => c.status === 'APPROVED');
            if (ready) onPick(ready.id);
          }}
        />
      ) : null}
    </>
  );
}
