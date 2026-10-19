import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '@voltex/ui';
import { ProjectType } from '@voltex/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Spinner,
} from '@voltex/ui';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { PROJECT_TYPE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

interface NewOpportunityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Conta já definida (aberto a partir da conta); sem ela, a pessoa escolhe. */
  accountId?: string;
}

export function NewOpportunityDialog({ open, onOpenChange, accountId }: NewOpportunityDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState(accountId ?? '');
  const [siteId, setSiteId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [title, setTitle] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('ON_GRID');
  const debounced = useDebouncedValue(search.trim());

  useEffect(() => {
    if (open) {
      setSearch('');
      setChosen(accountId ?? '');
      setSiteId('');
      setUnitId('');
      setTitle('');
      setProjectType('ON_GRID');
    }
  }, [open, accountId]);

  const accounts = useQuery({
    queryKey: queryKeys.accounts({ picker: debounced }),
    queryFn: () => endpoints.accounts.list({ pageSize: 20, search: debounced || undefined }),
    enabled: open && !accountId,
  });
  const detail = useQuery({
    queryKey: queryKeys.account(chosen),
    queryFn: () => endpoints.accounts.get(chosen),
    enabled: open && !!chosen,
  });

  const create = useMutation({
    mutationFn: () =>
      endpoints.opportunities.create({
        accountId: chosen,
        siteId: siteId || undefined,
        consumerUnitId: unitId || undefined,
        title: title.trim() || undefined,
        projectType,
      }),
    onSuccess: async (opportunity) => {
      toast.success(`Oportunidade criada (${opportunity.projectCode})`);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.opportunities() });
      await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
      void navigate(`/crm/oportunidades/${opportunity.id}`);
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível criar a oportunidade.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova oportunidade</DialogTitle>
          <DialogDescription>
            Cada oportunidade ganha um Project ID que acompanha o negócio até a operação.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {accountId ? null : (
            <>
              <Field id="opp-search" label="Buscar conta">
                <Input
                  id="opp-search"
                  type="search"
                  placeholder="Nome, e-mail ou documento"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Field>
              <Field
                id="opp-account"
                label="Conta"
                hint="Sem conta? Converta um lead ou cadastre em Contas."
              >
                <NativeSelect
                  id="opp-account"
                  value={chosen}
                  onChange={(e) => {
                    setChosen(e.target.value);
                    setSiteId('');
                    setUnitId('');
                  }}
                >
                  <option value="">Selecione</option>
                  {accounts.data?.data.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          )}
          {chosen && detail.data ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="opp-site" label="Imóvel">
                <NativeSelect
                  id="opp-site"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                >
                  <option value="">Definir depois</option>
                  {detail.data.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="opp-unit" label="Unidade consumidora">
                <NativeSelect
                  id="opp-unit"
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                >
                  <option value="">Definir depois</option>
                  {detail.data.consumerUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      UC {u.number}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="opp-title" label="Título (opcional)">
              <Input id="opp-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field id="opp-type" label="Tipo de sistema">
              <NativeSelect
                id="opp-type"
                value={projectType}
                onChange={(e) => setProjectType(e.target.value as ProjectType)}
              >
                {Object.values(ProjectType).map((p) => (
                  <option key={p} value={p}>
                    {PROJECT_TYPE_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!chosen || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner /> : null}
            Criar oportunidade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
