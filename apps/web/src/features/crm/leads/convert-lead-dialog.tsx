import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from '@voltex/ui';
import { AccountType, ProjectType, type LeadDto } from '@voltex/shared';
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
  Switch,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { useAuth } from '@/features/auth/auth-provider';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { ACCOUNT_TYPE_LABELS, PROJECT_TYPE_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';

/** Converte o lead em conta + contato e, se a pessoa pode, abre a oportunidade (RF-CRM-011). */
export function ConvertLeadDialog({
  lead,
  onOpenChange,
}: {
  lead: LeadDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  // Quem não pode criar oportunidades (ex.: SDR) converte só em conta: o switch nem aparece.
  const canOpportunity = can('crm.opportunity.write');
  const queryClient = useQueryClient();
  const [accountType, setAccountType] = useState<AccountType>('PERSON');
  const [createOpportunity, setCreateOpportunity] = useState(true);
  const [projectType, setProjectType] = useState<ProjectType>('ON_GRID');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (lead) {
      setAccountType('PERSON');
      setCreateOpportunity(true);
      setProjectType('ON_GRID');
      setTitle('');
    }
  }, [lead]);

  const convert = useMutation({
    mutationFn: () => {
      if (!lead) throw new Error('Nenhum lead selecionado');
      return endpoints.leads.convert(lead.id, {
        accountType,
        createOpportunity: canOpportunity && createOpportunity,
        projectType,
        opportunityTitle: title.trim() || undefined,
      });
    },
    onSuccess: async (result) => {
      toast.success(
        result.opportunityId ? 'Lead convertido em oportunidade' : 'Lead convertido em conta',
      );
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.leads() });
      void navigate(
        result.opportunityId
          ? `/crm/oportunidades/${result.opportunityId}`
          : `/crm/contas/${result.accountId}`,
      );
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível converter o lead.')),
  });

  return (
    <Dialog open={lead !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Converter lead</DialogTitle>
          <DialogDescription>
            Cria a conta e o contato principal de <strong>{lead?.name}</strong>. Se já existir uma
            conta com o mesmo documento, ela é reaproveitada.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field id="convert-type" label="Tipo de cliente">
            <NativeSelect
              id="convert-type"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as AccountType)}
            >
              {Object.values(AccountType).map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Can permission="crm.opportunity.write">
            <label className="flex items-center justify-between gap-4 text-sm">
              Abrir uma oportunidade agora
              <Switch
                checked={createOpportunity}
                onCheckedChange={setCreateOpportunity}
                aria-label="Abrir uma oportunidade agora"
              />
            </label>
            {createOpportunity ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="convert-project" label="Tipo de sistema">
                  <NativeSelect
                    id="convert-project"
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
                <Field id="convert-title" label="Título (opcional)">
                  <Input
                    id="convert-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={`Sistema solar — ${lead?.name ?? ''}`}
                  />
                </Field>
              </div>
            ) : null}
          </Can>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={convert.isPending} onClick={() => convert.mutate()}>
            {convert.isPending ? <Spinner /> : null}
            Converter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
