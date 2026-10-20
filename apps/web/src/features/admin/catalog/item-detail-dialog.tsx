import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EquipmentDetailDto, InmetroStatus } from '@voltex/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { useAuth } from '@/features/auth/auth-provider';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, fieldErrors, isApiError } from '@/lib/api/errors';
import { formatDate } from '@/lib/format';
import { ConfirmDialog } from '../company/confirm-delete';
import { queryKeys } from '../query-keys';
import {
  CATALOG_FIELDS,
  INMETRO_LABELS,
  KIND_SINGULAR,
  ORIGIN_LABELS,
  STATUS_LABELS,
} from './catalog-fields';
import { EquipmentFormDialog, type EquipmentFormValues } from './equipment-form-dialog';

const STATUS_BADGE = { DRAFT: 'secondary', APPROVED: 'green', RETIRED: 'outline' } as const;

function valueText(value: unknown, unit?: string): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  const text = typeof value === 'number' ? value.toLocaleString('pt-BR') : String(value);
  return unit ? `${text} ${unit}` : text;
}

export function ItemDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'retire' | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [inmetro, setInmetro] = useState<{ status: InmetroStatus; registration: string }>({
    status: 'VERIFIED',
    registration: '',
  });

  const item = useQuery({
    queryKey: queryKeys.catalogItem(id ?? ''),
    queryFn: () => endpoints.catalog.get(id as string),
    enabled: id !== null,
  });

  const refresh = async (updated?: EquipmentDetailDto | { id: string }) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.catalog() });
    if (updated && id) await queryClient.invalidateQueries({ queryKey: queryKeys.catalogItem(id) });
  };
  const fail = (fallback: string) => (error: unknown) => {
    if (isApiError(error) && error.code === 'EQUIPMENT_HAS_ERRORS') {
      const issues = (error.data?.issues ?? []) as { message: string }[];
      toast.error(`Não foi possível aprovar: ${issues.map((i) => i.message).join(' ')}`);
    } else toast.error(errorMessage(error, fallback));
  };

  const approve = useMutation({
    mutationFn: () => endpoints.catalog.approve(id as string),
    onSuccess: async (data) => {
      toast.success('Equipamento aprovado: já pode ser usado em projetos.');
      await refresh(data);
    },
    onError: fail('Não foi possível aprovar.'),
  });
  const retire = useMutation({
    mutationFn: () => endpoints.catalog.retire(id as string),
    onSuccess: async () => {
      toast.success('Equipamento aposentado.');
      setConfirm(null);
      await refresh({ id: id as string });
    },
    onError: fail('Não foi possível aposentar.'),
  });
  const remove = useMutation({
    mutationFn: () => endpoints.catalog.remove(id as string),
    onSuccess: async () => {
      toast.success('Rascunho excluído.');
      setConfirm(null);
      await refresh();
      onClose();
    },
    onError: fail('Não foi possível excluir.'),
  });
  const revise = useMutation({
    mutationFn: () => endpoints.catalog.revise(id as string),
    onSuccess: async () => {
      toast.success('Nova revisão criada em rascunho. Edite e aprove.');
      await refresh();
      onClose();
    },
    onError: fail('Não foi possível criar a revisão.'),
  });
  const saveInmetro = useMutation({
    mutationFn: () =>
      endpoints.catalog.inmetro(id as string, {
        status: inmetro.status,
        ...(inmetro.registration.trim() ? { registration: inmetro.registration.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.success('Conferência do INMETRO registrada.');
      await refresh({ id: id as string });
    },
    onError: fail('Não foi possível registrar a conferência.'),
  });
  const update = useMutation({
    mutationFn: (values: EquipmentFormValues) =>
      endpoints.catalog.update(id as string, {
        manufacturer: values.manufacturer,
        model: values.model,
        spec: values.spec,
      }),
    onSuccess: async () => {
      toast.success('Rascunho atualizado.');
      setEditing(false);
      setServerErrors({});
      await refresh({ id: id as string });
    },
    onError: (error) => {
      setServerErrors(fieldErrors(error));
      toast.error(errorMessage(error, 'Não foi possível salvar.'));
    },
  });
  const attach = useMutation({
    mutationFn: async (file: File) => {
      const doc = await endpoints.documents.upload(file, {
        entityType: 'EquipmentItem',
        entityId: id as string,
      });
      return endpoints.catalog.attachDatasheet(id as string, doc.id);
    },
    onSuccess: async () => {
      toast.success('Ficha técnica anexada.');
      await refresh({ id: id as string });
    },
    onError: fail('Não foi possível anexar a ficha.'),
  });

  const data = item.data;
  const fields = data ? CATALOG_FIELDS[data.kind] : [];
  const spec = (data?.spec ?? {}) as unknown as Record<string, unknown>;
  const isDraft = data?.status === 'DRAFT';
  const hasErrors = data?.issues.some((i) => i.severity === 'ERROR') ?? false;

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        {!data ? (
          <>
            <DialogHeader>
              <DialogTitle>Equipamento</DialogTitle>
            </DialogHeader>
            <Skeleton className="h-40 w-full" />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {data.manufacturer} {data.model}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_BADGE[data.status]}>{STATUS_LABELS[data.status]}</Badge>
                <span>
                  {KIND_SINGULAR[data.kind]} · revisão {data.revision} ·{' '}
                  {ORIGIN_LABELS[data.origin]}
                </span>
                {data.approvedAt ? <span>aprovado em {formatDate(data.approvedAt)}</span> : null}
                {data.datasheetDocumentId ? <Badge variant="outline">ficha anexada</Badge> : null}
              </DialogDescription>
            </DialogHeader>

            {data.issues.length > 0 ? (
              <ul className="space-y-1.5" aria-label="Conferência da ficha">
                {data.issues.map((issue) => (
                  <li
                    key={`${issue.code}-${issue.field}`}
                    className={`rounded border p-2 text-sm ${issue.severity === 'ERROR' ? 'border-destructive/50 text-destructive' : 'text-muted-foreground'}`}
                  >
                    <strong>{issue.severity === 'ERROR' ? 'Erro: ' : 'Aviso: '}</strong>
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}

            <dl className="grid gap-x-8 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="flex justify-between gap-4 border-b py-1.5 text-sm">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="font-medium tabular-nums">
                    {f.type === 'select'
                      ? (f.options?.find((o) => o.value === spec[f.key])?.label ??
                        valueText(spec[f.key]))
                      : valueText(spec[f.key], f.unit)}
                  </dd>
                </div>
              ))}
            </dl>

            {data.kind === 'MODULE' || data.kind === 'INVERTER' ? (
              <section className="space-y-2 rounded-lg border p-3">
                <h3 className="text-sm font-medium">Registro no INMETRO</h3>
                <p className="text-sm text-muted-foreground">
                  {INMETRO_LABELS[data.inmetroStatus]}
                  {data.inmetroRegistration ? ` · registro ${data.inmetroRegistration}` : ''}
                  {data.inmetroCheckedAt
                    ? ` · conferido em ${formatDate(data.inmetroCheckedAt)}`
                    : ''}
                </p>
                <Can permission="platform.catalog.manage">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="grid gap-1">
                      <Label htmlFor="inm-status">Resultado da consulta</Label>
                      <NativeSelect
                        id="inm-status"
                        value={inmetro.status}
                        onChange={(e) =>
                          setInmetro((v) => ({ ...v, status: e.target.value as InmetroStatus }))
                        }
                      >
                        <option value="VERIFIED">Registro encontrado e válido</option>
                        <option value="NOT_FOUND">Sem registro</option>
                        <option value="NOT_APPLICABLE">Não se aplica</option>
                      </NativeSelect>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="inm-reg">Número do registro</Label>
                      <Input
                        id="inm-reg"
                        value={inmetro.registration}
                        onChange={(e) =>
                          setInmetro((v) => ({ ...v, registration: e.target.value }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saveInmetro.isPending}
                      onClick={() => saveInmetro.mutate()}
                    >
                      Registrar conferência
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Consulte o registro no site do INMETRO e anote aqui o resultado. O sistema não
                    consulta o INMETRO sozinho e lembra de reconferir a cada 6 meses.
                  </p>
                </Can>
              </section>
            ) : null}

            {data.revisions.length > 0 ? (
              <section>
                <h3 className="mb-1 text-sm font-medium">Outras revisões</h3>
                <ul className="text-sm text-muted-foreground">
                  {data.revisions.map((r) => (
                    <li key={r.id}>
                      Revisão {r.revision}: {STATUS_LABELS[r.status]}
                      {r.approvedAt ? ` (aprovada em ${formatDate(r.approvedAt)})` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <Can permission="platform.catalog.manage">
              <div className="grid gap-1.5">
                <Label htmlFor="datasheet">Anexar ficha técnica (PDF)</Label>
                <Input
                  id="datasheet"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={attach.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) attach.mutate(file);
                  }}
                />
              </div>
            </Can>

            <DialogFooter className="flex-wrap gap-2">
              <Can permission="platform.catalog.manage">
                {isDraft ? (
                  <>
                    <Button variant="outline" onClick={() => setEditing(true)}>
                      Editar
                    </Button>
                    <Button variant="outline" onClick={() => setConfirm('delete')}>
                      Excluir rascunho
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    disabled={revise.isPending}
                    onClick={() => revise.mutate()}
                  >
                    Nova revisão
                  </Button>
                )}
              </Can>
              {can('engine.project.approve') && isDraft ? (
                <Button disabled={approve.isPending || hasErrors} onClick={() => approve.mutate()}>
                  {approve.isPending ? <Spinner /> : null}
                  Aprovar para uso
                </Button>
              ) : null}
              {can('engine.project.approve') && data.status === 'APPROVED' ? (
                <Button variant="outline" onClick={() => setConfirm('retire')}>
                  Aposentar
                </Button>
              ) : null}
            </DialogFooter>
            {isDraft && !can('engine.project.approve') ? (
              <p className="text-xs text-muted-foreground">
                A aprovação é do responsável técnico. Enquanto for rascunho, o item não aparece nos
                projetos.
              </p>
            ) : null}

            <EquipmentFormDialog
              open={editing}
              onOpenChange={setEditing}
              kind={data.kind}
              title="Editar rascunho"
              initial={{ manufacturer: data.manufacturer, model: data.model, spec }}
              pending={update.isPending}
              serverErrors={serverErrors}
              onSubmit={(values) => update.mutate(values)}
            />
            <ConfirmDialog
              open={confirm !== null}
              onOpenChange={(open) => !open && setConfirm(null)}
              title={confirm === 'delete' ? 'Excluir rascunho?' : 'Aposentar equipamento?'}
              description={
                confirm === 'delete'
                  ? 'O rascunho será apagado. Isso não pode ser desfeito.'
                  : 'O equipamento deixa de aparecer em novos projetos. Projetos já aprovados continuam com a ficha copiada.'
              }
              confirmLabel={confirm === 'delete' ? 'Excluir' : 'Aposentar'}
              onConfirm={() => (confirm === 'delete' ? remove.mutate() : retire.mutate())}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
