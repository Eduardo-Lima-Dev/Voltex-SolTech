import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router';
import { Alert, Button, Input, Skeleton, Spinner } from '@voltex/ui';
import type { PublicProposalDto, PublicProposalScenarioDto } from '@voltex/shared';
import { Field } from '@/components/field';
import { queryKeys } from '@/features/admin/query-keys';
import { endpoints } from '@/lib/api/endpoints';
import { API_BASE_URL, errorMessage, isApiError } from '@/lib/api';
import {
  formatCents,
  formatDate,
  formatDateTime,
  formatKwh,
  formatNumber,
  formatPercent,
  formatYears,
} from '@/lib/format';

const Charts = lazy(() => import('./charts'));
const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = '#0a7d3b';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

function Scenario({ scenario, color }: { scenario: PublicProposalScenarioDto; color: string }) {
  return (
    <section
      aria-label={scenario.label}
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">{scenario.label}</h2>
        <p className="text-2xl font-bold" style={{ color }}>
          {formatCents(scenario.priceCents)}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="Potência instalada"
          value={`${formatNumber(scenario.installedPowerKwp, 2)} kWp`}
        />
        <Metric
          label="Módulos"
          value={`${scenario.moduleCount} (${formatNumber(scenario.estimatedAreaM2, 1)} m²)`}
        />
        <Metric label="Geração anual estimada" value={formatKwh(scenario.annualGenerationKwh)} />
        <Metric
          label="Consumo médio mensal"
          value={formatKwh(scenario.averageMonthlyConsumptionKwh)}
        />
        <Metric
          label="Compensação do consumo"
          value={formatPercent(scenario.compensationRatio, 0)}
        />
        <Metric label="Economia no 1º ano" value={formatCents(scenario.firstYearSavingsCents)} />
        <Metric
          label={`Economia em ${scenario.horizonYears} anos`}
          value={formatCents(scenario.accumulatedSavingsCents)}
        />
        <Metric label="Retorno do investimento" value={formatYears(scenario.simplePaybackYears)} />
      </dl>
      <Suspense fallback={<Skeleton className="h-56 w-full" />}>
        <Charts scenario={scenario} color={color} />
      </Suspense>
    </section>
  );
}

function AcceptForm({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; acknowledge?: string }>({});
  const accept = useMutation({
    mutationFn: () =>
      endpoints.publicProposals.accept(token, {
        name: name.trim(),
        document: document.trim() || undefined,
        acknowledge: true,
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.publicProposal(token), data),
  });

  const submit = () => {
    const next: typeof errors = {};
    if (name.trim().length < 3) next.name = 'Informe seu nome completo';
    if (!acknowledge) next.acknowledge = 'É necessário confirmar o aceite';
    setErrors(next);
    if (Object.keys(next).length === 0) accept.mutate();
  };

  return (
    <form
      noValidate
      aria-label="Aceite da proposta"
      className="space-y-4 rounded-xl border bg-card p-5 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="text-lg font-semibold">Aceitar a proposta</h2>
      <p className="text-sm text-muted-foreground">
        O aceite fica registrado com o seu nome, a data e o horário. Depois dele, a equipe entra em
        contato para o contrato.
      </p>
      <Field id="accept-name" label="Nome completo" error={errors.name}>
        <Input
          id="accept-name"
          autoComplete="name"
          aria-invalid={errors.name ? true : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field id="accept-document" label="CPF ou CNPJ (opcional)">
        <Input
          id="accept-document"
          inputMode="numeric"
          value={document}
          onChange={(e) => setDocument(e.target.value)}
        />
      </Field>
      <div className="space-y-1">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={acknowledge}
            onChange={(e) => setAcknowledge(e.target.checked)}
          />
          <span>Li a proposta, as condições e as ressalvas, e aceito.</span>
        </label>
        {errors.acknowledge ? (
          <p role="alert" className="text-xs text-destructive">
            {errors.acknowledge}
          </p>
        ) : null}
      </div>
      {accept.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(accept.error, 'Não foi possível registrar o aceite.')}
        </p>
      ) : null}
      <Button type="submit" disabled={accept.isPending}>
        {accept.isPending ? <Spinner /> : null}
        Aceitar proposta
      </Button>
    </form>
  );
}

function Banner({ proposal }: { proposal: PublicProposalDto }) {
  if (proposal.status === 'ACCEPTED')
    return (
      <Alert variant="info">
        <CheckCircle2 aria-hidden />
        <p>
          Proposta aceita por <strong>{proposal.acceptedByName}</strong>
          {proposal.acceptedAt ? ` em ${formatDateTime(proposal.acceptedAt)}` : ''}. Nossa equipe
          entrará em contato.
        </p>
      </Alert>
    );
  if (proposal.status === 'SUPERSEDED')
    return (
      <Alert variant="warning">
        <p>
          Esta proposta foi substituída por uma versão mais nova. Peça o novo link a quem atende
          você.
        </p>
      </Alert>
    );
  if (proposal.expired)
    return (
      <Alert variant="warning">
        <p>A validade desta proposta acabou. Peça uma nova a quem atende você.</p>
      </Alert>
    );
  return null;
}

export function PublicProposalPage() {
  const { token = '' } = useParams();
  const proposal = useQuery({
    queryKey: queryKeys.publicProposal(token),
    queryFn: () => endpoints.publicProposals.get(token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (proposal.isPending)
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  if (proposal.isError)
    return (
      <main className="mx-auto max-w-xl space-y-3 p-8 text-center">
        <h1 className="text-2xl font-semibold">Proposta não encontrada</h1>
        <p className="text-muted-foreground">
          {isApiError(proposal.error) && proposal.error.status === 404
            ? 'O link está incorreto ou foi substituído por um mais novo. Peça o link atual a quem atende você.'
            : 'Não foi possível abrir a proposta agora. Tente novamente em instantes.'}
        </p>
      </main>
    );

  const data = proposal.data;
  const color =
    data.brand.primaryColor && HEX.test(data.brand.primaryColor)
      ? data.brand.primaryColor
      : DEFAULT_COLOR;
  const canAccept = (data.status === 'SENT' || data.status === 'VIEWED') && !data.expired;
  const canDownload = data.status !== 'SUPERSEDED';

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header
        className="flex flex-wrap items-center justify-between gap-4 border-b-4 pb-4"
        style={{ borderColor: color }}
      >
        <div className="flex items-center gap-3">
          {data.brand.hasLogo ? (
            <img
              src={`${API_BASE_URL}${endpoints.publicProposals.logoUrl(token)}`}
              alt={`Logo de ${data.tenantName}`}
              className="max-h-14 max-w-40 object-contain"
            />
          ) : null}
          <p className="text-lg font-semibold">{data.tenantName}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Proposta v{data.version} · válida até {formatDate(data.validUntil)}
        </p>
      </header>

      <section className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{data.title}</h1>
        <p className="text-muted-foreground">
          Para {data.customerName} · <span className="font-mono">{data.projectCode}</span>
        </p>
      </section>

      <Banner proposal={data} />

      <div className="space-y-6">
        {data.scenarios.map((scenario) => (
          <Scenario key={scenario.label} scenario={scenario} color={color} />
        ))}
      </div>

      {data.conditions.paymentTerms || data.conditions.notes ? (
        <section className="space-y-2 rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Condições</h2>
          {data.conditions.paymentTerms ? (
            <p className="text-sm">
              <span className="font-medium">Pagamento:</span> {data.conditions.paymentTerms}
            </p>
          ) : null}
          {data.conditions.notes ? <p className="text-sm">{data.conditions.notes}</p> : null}
        </section>
      ) : null}

      {canDownload ? (
        <Button asChild variant="outline">
          <a
            href={`${API_BASE_URL}${endpoints.publicProposals.pdfUrl(token)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Download /> Baixar PDF
          </a>
        </Button>
      ) : null}

      {canAccept ? <AcceptForm token={token} /> : null}

      <footer className="border-t pt-4 text-xs text-muted-foreground">{data.disclaimer}</footer>
    </main>
  );
}
