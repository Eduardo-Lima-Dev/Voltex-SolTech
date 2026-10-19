import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FilePlus2, FileSignature } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import type { ContractDto, OpportunityStage } from '@voltex/shared';
import { Can } from '@/app/guards';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { JustificationDialog } from '@/features/crm/justification-dialog';
import { CONTRACT_STATUS_LABELS } from '@/i18n/labels';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatCents, formatDate, formatDateTime } from '@/lib/format';

const STATUS_BADGE = { DRAFT: 'secondary', SIGNED: 'green', CANCELLED: 'outline' } as const;
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

function useRefreshContracts(opportunityId: string) {
  const queryClient = useQueryClient();
  return async () => {
    for (const key of [
      queryKeys.opportunityContracts(opportunityId),
      queryKeys.opportunityTimeline(opportunityId),
      queryKeys.opportunity(opportunityId),
      queryKeys.opportunityProject(opportunityId),
    ])
      await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: ['opportunity-board'] });
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
  };
}

interface Scenario {
  quoteId: string;
  label: string;
}

function GenerateDialog({
  opportunityId,
  open,
  onOpenChange,
}: {
  opportunityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshContracts(opportunityId);
  const [customerDocument, setCustomerDocument] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [companyDocument, setCompanyDocument] = useState('');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [quoteId, setQuoteId] = useState('');

  useEffect(() => {
    if (open) {
      setScenarios([]);
      setQuoteId('');
    }
  }, [open]);

  const generate = useMutation({
    mutationFn: () =>
      endpoints.contracts.generate(opportunityId, {
        customerDocument: customerDocument.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        companyDocument: companyDocument.trim() || undefined,
        quoteId: quoteId || undefined,
      }),
    onSuccess: async () => {
      toast.success('Contrato gerado');
      onOpenChange(false);
      await refresh();
    },
    onError: (error) => {
      // Com mais de um cenário o servidor pede a escolha do cliente.
      if (isApiError(error) && error.code === 'SCENARIO_REQUIRED') {
        setScenarios((error.data?.scenarios as Scenario[] | undefined) ?? []);
        return;
      }
      toast.error(errorMessage(error, 'Não foi possível gerar o contrato.'));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerar contrato</DialogTitle>
          <DialogDescription>
            Parte da proposta aceita pelo cliente. Preencha o que ainda não está no cadastro: o que
            faltar sai como “(não informado)” no texto.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            generate.mutate();
          }}
        >
          <Field id="contract-customer-doc" label="CPF/CNPJ do cliente">
            <Input
              id="contract-customer-doc"
              value={customerDocument}
              onChange={(e) => setCustomerDocument(e.target.value)}
            />
          </Field>
          <Field id="contract-address" label="Endereço da instalação (se diferente do imóvel)">
            <Input
              id="contract-address"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
            />
          </Field>
          <Field id="contract-company-doc" label="CNPJ da empresa (se não estiver em Empresa)">
            <Input
              id="contract-company-doc"
              value={companyDocument}
              onChange={(e) => setCompanyDocument(e.target.value)}
            />
          </Field>
          {scenarios.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Cenário escolhido pelo cliente</legend>
              {scenarios.map((s) => (
                <label key={s.quoteId} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scenario"
                    checked={quoteId === s.quoteId}
                    onChange={() => setQuoteId(s.quoteId)}
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={generate.isPending || (scenarios.length > 0 && !quoteId)}
            >
              {generate.isPending ? <Spinner /> : null}
              Gerar contrato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignDialog({
  contract,
  opportunityId,
  onClose,
}: {
  contract: ContractDto | null;
  opportunityId: string;
  onClose: () => void;
}) {
  const refresh = useRefreshContracts(opportunityId);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [signedByName, setSignedByName] = useState('');
  const [signedAt, setSignedAt] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (contract) {
      setFile(null);
      setSignedByName('');
      setSignedAt('');
      setError(undefined);
    }
  }, [contract]);

  const sign = useMutation({
    mutationFn: () =>
      endpoints.contracts.sign((contract as ContractDto).id, file as File, {
        signedByName: signedByName.trim() || undefined,
        signedAt: signedAt ? new Date(`${signedAt}T12:00:00`).toISOString() : undefined,
      }),
    onSuccess: async () => {
      toast.success('Contrato assinado: negócio ganho e projeto criado');
      onClose();
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível registrar a assinatura.')),
  });

  const submit = () => {
    if (!file) return setError('Anexe o contrato assinado (PDF, PNG ou JPEG)');
    if (!ACCEPTED_TYPES.includes(file.type)) return setError('Use PDF, PNG ou JPEG');
    setError(undefined);
    sign.mutate();
  };

  return (
    <Dialog open={contract !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar contrato assinado</DialogTitle>
          <DialogDescription>
            Anexe o arquivo digitalizado. Ao confirmar, a oportunidade vira <strong>Ganho</strong> e
            o projeto de homologação é criado com o mesmo Project ID. Isso não pode ser desfeito
            aqui.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="sign-file" label="Contrato assinado" error={error}>
            <input
              ref={input}
              id="sign-file"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field id="sign-name" label="Quem assinou pelo cliente (opcional)">
            <Input
              id="sign-name"
              value={signedByName}
              onChange={(e) => setSignedByName(e.target.value)}
            />
          </Field>
          <Field id="sign-date" label="Data da assinatura (padrão: hoje)">
            <Input
              id="sign-date"
              type="date"
              value={signedAt}
              onChange={(e) => setSignedAt(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={sign.isPending}>
              {sign.isPending ? <Spinner /> : null}
              Confirmar assinatura
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContractTab({
  opportunityId,
  stage,
  open,
}: {
  opportunityId: string;
  stage: OpportunityStage;
  open: boolean;
}) {
  const refresh = useRefreshContracts(opportunityId);
  const [generating, setGenerating] = useState(false);
  const [signing, setSigning] = useState<ContractDto | null>(null);
  const [cancelling, setCancelling] = useState<ContractDto | null>(null);
  const contracts = useQuery({
    queryKey: queryKeys.opportunityContracts(opportunityId),
    queryFn: () => endpoints.contracts.list(opportunityId),
  });
  const cancel = useMutation({
    mutationFn: ({ contract, reason }: { contract: ContractDto; reason: string }) =>
      endpoints.contracts.cancel(contract.id, { reason }),
    onSuccess: async () => {
      toast.success('Contrato cancelado');
      setCancelling(null);
      await refresh();
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível cancelar o contrato.')),
  });
  const download = useMutation({
    mutationFn: async ({ contract, signed }: { contract: ContractDto; signed: boolean }) => {
      const { url } = signed
        ? await endpoints.contracts.signedUrl(contract.id)
        : await endpoints.contracts.pdfUrl(contract.id);
      window.open(url, '_blank', 'noopener');
    },
    onError: (e) => toast.error(errorMessage(e, 'Não foi possível abrir o arquivo.')),
  });

  if (contracts.isPending) return <Skeleton className="h-24 w-full" />;
  if (contracts.isError)
    return <p className="text-sm text-destructive">Não foi possível carregar os contratos.</p>;

  const active = contracts.data.find((c) => c.status !== 'CANCELLED');
  const canGenerate = open && stage === 'CONTRACT' && !active;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O contrato nasce da proposta aceita. O ganho só é registrado quando o contrato assinado é
        anexado: nesse momento nasce o projeto de homologação.
      </p>
      <Can permission="crm.contract.write">
        {canGenerate ? (
          <div>
            <Button size="sm" onClick={() => setGenerating(true)}>
              <FilePlus2 /> Gerar contrato
            </Button>
          </div>
        ) : null}
      </Can>
      {open && stage !== 'CONTRACT' && !active ? (
        <p className="text-sm text-muted-foreground">
          O contrato é gerado quando a oportunidade está na etapa Contrato (depois do aceite da
          proposta).
        </p>
      ) : null}

      {contracts.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum contrato.</p>
      ) : (
        <ul className="space-y-3">
          {contracts.data.map((contract) => (
            <li key={contract.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-medium">Contrato v{contract.version}</h4>
                  <Badge variant={STATUS_BADGE[contract.status]}>
                    {CONTRACT_STATUS_LABELS[contract.status]}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {contract.scenarioLabel} · proposta v{contract.proposalVersion}
                  </span>
                </div>
                <span className="font-semibold">{formatCents(contract.valueCents)}</span>
              </div>
              {contract.templateIsDefault && contract.status === 'DRAFT' ? (
                <Alert variant="warning">
                  <p>
                    Gerado com o <strong>modelo-base</strong>, que não tem revisão jurídica.
                    Publique o modelo da sua empresa em Administração → Contratos.
                  </p>
                </Alert>
              ) : null}
              {contract.missingVariables.length > 0 && contract.status === 'DRAFT' ? (
                <p className="text-sm text-muted-foreground">
                  Faltam dados no texto: {contract.missingVariables.join(', ')}. Cancele o rascunho
                  e gere de novo com os dados completos.
                </p>
              ) : null}
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Ver o texto</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {contract.body}
                </pre>
              </details>
              {contract.status === 'SIGNED' ? (
                <p className="text-sm text-muted-foreground">
                  Assinado{contract.signedByName ? ` por ${contract.signedByName}` : ''} em{' '}
                  {contract.signedAt ? formatDate(contract.signedAt) : '—'}. Registrado em{' '}
                  {formatDateTime(contract.createdAt)}.
                </p>
              ) : null}
              {contract.status === 'CANCELLED' ? (
                <p className="text-sm text-muted-foreground">Motivo: {contract.cancelReason}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {contract.pdfDocumentId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => download.mutate({ contract, signed: false })}
                  >
                    <Download /> PDF
                  </Button>
                ) : null}
                {contract.signedDocumentId ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => download.mutate({ contract, signed: true })}
                  >
                    <Download /> Assinado
                  </Button>
                ) : null}
                {contract.projectId ? (
                  <Button asChild size="sm">
                    <Link to={`/crm/projetos/${contract.projectId}`}>Abrir o projeto</Link>
                  </Button>
                ) : null}
                <Can permission={['crm.contract.write', 'platform.document.write']}>
                  {open && contract.status === 'DRAFT' ? (
                    <Button size="sm" onClick={() => setSigning(contract)}>
                      <FileSignature /> Registrar assinatura
                    </Button>
                  ) : null}
                </Can>
                <Can permission="crm.contract.write">
                  {open && contract.status === 'DRAFT' ? (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(contract)}>
                      Cancelar rascunho
                    </Button>
                  ) : null}
                </Can>
              </div>
            </li>
          ))}
        </ul>
      )}

      <GenerateDialog
        opportunityId={opportunityId}
        open={generating}
        onOpenChange={setGenerating}
      />
      <SignDialog
        contract={signing}
        opportunityId={opportunityId}
        onClose={() => setSigning(null)}
      />
      <JustificationDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancelar o rascunho"
        description="O texto não pode ser editado: para ajustar, cancele e gere outro."
        label="Motivo"
        confirmLabel="Cancelar contrato"
        minLength={5}
        pending={cancel.isPending}
        onConfirm={(reason) => cancelling && cancel.mutate({ contract: cancelling, reason })}
      />
    </div>
  );
}
