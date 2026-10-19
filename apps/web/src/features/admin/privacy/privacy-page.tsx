import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  NativeSelect,
  Skeleton,
  Spinner,
  toast,
} from '@voltex/ui';
import {
  RETENTION_FLOORS,
  type PrivacySubjectType,
  type RetentionPolicyInput,
} from '@voltex/shared';
import { Field } from '@/components/field';
import { Pagination } from '@/components/pagination';
import { ConfirmDialog } from '@/features/admin/company/confirm-delete';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { queryKeys } from '../query-keys';

const toNumber = (text: string): number | null => {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
};

function RetentionCard() {
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: queryKeys.retentionPolicy,
    queryFn: endpoints.privacy.policy,
  });
  const [leads, setLeads] = useState<string | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  const [contracts, setContracts] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const data = policy.data;
  const leadsText = leads ?? data?.policy.unconvertedLeadsMonths?.toString() ?? '';
  const lostText = lost ?? data?.policy.lostOpportunitiesMonths?.toString() ?? '';
  const contractsText = contracts ?? data?.policy.signedContractsMonths.toString() ?? '';

  const save = useMutation({
    mutationFn: (input: RetentionPolicyInput) => endpoints.privacy.updatePolicy(input),
    onSuccess: async () => {
      toast.success('Prazos salvos');
      setLeads(null);
      setLost(null);
      setContracts(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.retentionPolicy });
    },
    onError: (e) => setError(errorMessage(e, 'Não foi possível salvar os prazos.')),
  });

  const submit = () => {
    const contractsMonths = toNumber(contractsText);
    if (contractsMonths === null || contractsMonths < RETENTION_FLOORS.signedContractsMonths)
      return setError(
        `Contratos assinados devem ser guardados por, no mínimo, ${RETENTION_FLOORS.signedContractsMonths} meses (5 anos).`,
      );
    if (leadsText.trim() !== '' && toNumber(leadsText) === null)
      return setError(
        'Informe os meses de contatos sem venda como um número inteiro, ou deixe em branco.',
      );
    if (lostText.trim() !== '' && toNumber(lostText) === null)
      return setError(
        'Informe os meses de negócios perdidos como um número inteiro, ou deixe em branco.',
      );
    setError(undefined);
    save.mutate({
      unconvertedLeadsMonths: toNumber(leadsText),
      lostOpportunitiesMonths: toNumber(lostText),
      signedContractsMonths: contractsMonths,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prazos de guarda dos dados</CardTitle>
        <CardDescription>
          Depois do prazo, o sistema apaga sozinho os dados pessoais (nome, contatos, documento,
          endereço), mantendo só os números para as estatísticas. Em branco, nada é apagado
          automaticamente. A rotina roda uma vez por dia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {policy.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : policy.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar os prazos.</p>
        ) : (
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field
              id="ret-leads"
              label="Contatos que não viraram cliente (meses)"
              hint="Não há prazo mínimo na lei para quem nunca comprou: a decisão é da sua empresa."
            >
              <Input
                id="ret-leads"
                inputMode="numeric"
                placeholder="Em branco = nunca apagar"
                value={leadsText}
                onChange={(e) => setLeads(e.target.value)}
              />
            </Field>
            <Field
              id="ret-lost"
              label="Negócios perdidos (meses depois de perdido)"
              hint="Só apaga se não houver negócio em aberto nem contrato guardado."
            >
              <Input
                id="ret-lost"
                inputMode="numeric"
                placeholder="Em branco = nunca apagar"
                value={lostText}
                onChange={(e) => setLost(e.target.value)}
              />
            </Field>
            <Field
              id="ret-contracts"
              label="Contratos assinados (meses)"
              hint={`Mínimo de ${policy.data.floors.signedContractsMonths} meses. ${policy.data.sources.signedContractsMonths}`}
            >
              <Input
                id="ret-contracts"
                inputMode="numeric"
                value={contractsText}
                onChange={(e) => setContracts(e.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">{policy.data.sources.accessLogs}</p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                Salvar prazos
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

interface Candidate {
  id: string;
  title: string;
  detail: string;
}

function ErasureCard() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<PrivacySubjectType>('LEAD');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState<string>();
  const [formError, setFormError] = useState<string>();

  const results = useQuery({
    queryKey: ['erasure-search', type, submitted],
    enabled: submitted.length >= 3,
    queryFn: async (): Promise<Candidate[]> => {
      if (type === 'LEAD') {
        const page = await endpoints.leads.list({ search: submitted, pageSize: 8 });
        return page.data
          .filter((l) => l.status !== 'CONVERTED')
          .map((l) => ({
            id: l.id,
            title: l.name,
            detail: [l.email, l.phone].filter(Boolean).join(' · ') || 'Sem contato',
          }));
      }
      const page = await endpoints.accounts.list({ search: submitted, pageSize: 8 });
      return page.data.map((a) => ({
        id: a.id,
        title: a.name,
        detail: [a.email, a.phone].filter(Boolean).join(' · ') || 'Sem contato',
      }));
    },
  });

  const erase = useMutation({
    mutationFn: () =>
      endpoints.privacy.erase({
        subjectType: type,
        subjectId: (chosen as Candidate).id,
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      toast.success('Dados eliminados');
      setChosen(null);
      setReason('');
      setSubmitted('');
      setSearch('');
      setBlocked(undefined);
      await queryClient.invalidateQueries({ queryKey: ['erasures'] });
      await queryClient.invalidateQueries({ queryKey: ['erasure-search'] });
    },
    onError: async (e) => {
      setConfirming(false);
      if (isApiError(e) && e.code === 'ERASURE_BLOCKED') setBlocked(e.message);
      else toast.error(errorMessage(e, 'Não foi possível eliminar os dados.'));
      await queryClient.invalidateQueries({ queryKey: ['erasures'] });
    },
  });

  const ask = () => {
    if (!chosen) return setFormError('Escolha a pessoa na lista.');
    if (reason.trim().length < 5)
      return setFormError('Anote de onde veio o pedido (mínimo de 5 caracteres).');
    setFormError(undefined);
    setBlocked(undefined);
    setConfirming(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Atender um pedido de eliminação</CardTitle>
        <CardDescription>
          Quando uma pessoa pede que seus dados sejam apagados. O nome, os contatos, o documento, o
          endereço, os textos e os arquivos dela são removidos. O negócio fica só como número nas
          estatísticas. Não dá para desfazer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
          <NativeSelect
            aria-label="Tipo de cadastro"
            value={type}
            onChange={(e) => {
              setType(e.target.value as PrivacySubjectType);
              setChosen(null);
              setSubmitted('');
            }}
          >
            <option value="LEAD">Contato (lead)</option>
            <option value="ACCOUNT">Cliente (conta)</option>
          </NativeSelect>
          <Input
            aria-label="Buscar pessoa"
            placeholder="Nome, e-mail, telefone ou CPF/CNPJ completo (3+ letras)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' && (e.preventDefault(), setSubmitted(search.trim()))
            }
          />
          <Button type="button" variant="outline" onClick={() => setSubmitted(search.trim())}>
            <Search /> Buscar
          </Button>
        </div>

        {results.isFetching ? <Skeleton className="h-12 w-full" /> : null}
        {results.data && results.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ninguém encontrado. Contatos que já viraram cliente aparecem em “Cliente (conta)”.
          </p>
        ) : null}
        {results.data && results.data.length > 0 ? (
          <ul aria-label="Resultados" className="divide-y rounded-md border">
            {results.data.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={chosen?.id === c.id}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent ${chosen?.id === c.id ? 'bg-accent' : ''}`}
                  onClick={() => setChosen(c)}
                >
                  <span className="font-medium">{c.title}</span>
                  <span className="text-xs text-muted-foreground">{c.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {chosen ? (
          <div className="space-y-3">
            <p className="text-sm">
              Selecionado: <strong>{chosen.title}</strong>
            </p>
            <Field id="erasure-reason" label="De onde veio o pedido" error={formError}>
              <Input
                id="erasure-reason"
                placeholder="Ex.: e-mail do titular em 19/10"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button type="button" variant="destructive" onClick={ask}>
              Eliminar os dados desta pessoa
            </Button>
          </div>
        ) : null}

        {blocked ? (
          <Alert variant="warning">
            <p>
              <strong>Não foi possível eliminar agora.</strong> {blocked}
            </p>
          </Alert>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Eliminar os dados desta pessoa?"
        description={`Os dados de ${chosen?.title ?? ''} serão apagados de forma definitiva, inclusive faturas e arquivos. Não dá para desfazer.`}
        confirmLabel="Eliminar definitivamente"
        onConfirm={() => erase.mutate()}
      />
    </Card>
  );
}

function HistoryCard() {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: queryKeys.erasures(page),
    queryFn: () => endpoints.privacy.erasures({ page, pageSize: 10 }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pedidos já registrados</CardTitle>
        <CardDescription>
          Fica só a data, as iniciais e o resultado: nunca os dados da pessoa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : history.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p>
        ) : history.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pedido ainda.</p>
        ) : (
          <>
            <ul className="divide-y">
              {history.data.data.map((r) => (
                <li key={r.id} className="space-y-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.subjectLabel}</span>
                    <Badge variant="secondary">
                      {r.subjectType === 'LEAD' ? 'Contato' : 'Cliente'}
                    </Badge>
                    <Badge variant={r.status === 'COMPLETED' ? 'green' : 'yellow'}>
                      {r.status === 'COMPLETED' ? 'Eliminado' : 'Bloqueado'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    {r.reason}
                    {r.requestedByName
                      ? ` · por ${r.requestedByName}`
                      : r.requestedById === null
                        ? ' · automático (prazos de guarda)'
                        : ''}
                  </p>
                  {r.blockedReason ? (
                    <p className="text-xs">
                      {r.blockedReason}
                      {r.retainedUntil ? ` (até ${formatDate(r.retainedUntil)})` : ''}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <Pagination
              page={history.data.meta.page}
              pageSize={history.data.meta.pageSize}
              total={history.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function PrivacyPage() {
  return (
    <div className="space-y-6">
      <RetentionCard />
      <ErasureCard />
      <HistoryCard />
    </div>
  );
}
