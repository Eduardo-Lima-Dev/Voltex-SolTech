import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AiDiagnosticsDto, AiPurpose } from '@voltex/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage } from '@/lib/api/errors';
import { formatDate, formatDateTime } from '@/lib/format';

const PURPOSE_LABEL: Record<AiPurpose, string> = {
  CHAT: 'Assistente',
  INSIGHTS: 'Insights',
  PROCUREMENT: 'Compras',
  DIAGNOSTICS: 'Diagnóstico',
};

const settingsKey = ['ai', 'admin', 'settings'] as const;
const usageKey = ['ai', 'admin', 'usage'] as const;

function SettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => endpoints.ai.admin.settings(),
  });
  const [accepted, setAccepted] = useState(false);

  const update = useMutation({
    mutationFn: (enabled: boolean) =>
      endpoints.ai.admin.update(enabled ? { enabled, acceptTerms: true } : { enabled }),
    onSuccess: async (_data, enabled) => {
      toast.success(enabled ? 'IA ligada para a empresa' : 'IA desligada para a empresa');
      setAccepted(false);
      await queryClient.invalidateQueries({ queryKey: ['ai'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (settings.isPending) return <Skeleton className="h-48 w-full" />;
  if (settings.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(settings.error)}</AlertDescription>
      </Alert>
    );
  }
  const { settings: current, demo, legalReviewed, status } = settings.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Assistente de IA
          <Badge variant={current.enabled ? 'green' : 'outline'}>
            {current.enabled ? 'Ligado' : 'Desligado'}
          </Badge>
          {demo ? <Badge variant="yellow">Empresa de demonstração</Badge> : null}
        </CardTitle>
        <CardDescription>
          O assistente responde só com dados do sistema, respeitando o perfil de quem pergunta.
          Dados pessoais são trocados por pseudônimos antes de sair do servidor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!legalReviewed && !demo ? (
          <Alert>
            <AlertDescription>
              A revisão jurídica do uso de IA ainda não foi registrada neste ambiente. Enquanto
              isso, a IA só funciona em empresas de demonstração.
            </AlertDescription>
          </Alert>
        ) : null}

        {current.enabled ? (
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Desligar a IA da empresa</p>
              {current.termsAcceptedAt ? (
                <p className="text-xs text-muted-foreground">
                  Termos aceitos em {formatDateTime(current.termsAcceptedAt)}
                </p>
              ) : null}
            </div>
            <Switch
              checked
              aria-label="IA ligada"
              disabled={update.isPending}
              onCheckedChange={() => update.mutate(false)}
            />
          </div>
        ) : (
          <div className="space-y-3 rounded-md border p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>
                Li e aceito os termos de uso da IA: as respostas são geradas automaticamente a
                partir dos dados do sistema, podem conter erros e devem ser conferidas antes de
                decidir.
              </span>
            </label>
            <Button disabled={!accepted || update.isPending} onClick={() => update.mutate(true)}>
              Ligar a IA
            </Button>
          </div>
        )}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Situação para você</dt>
            <dd className="font-medium">
              {status.available ? 'Disponível' : (status.message ?? 'Indisponível')}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Modelo</dt>
            <dd className="font-medium">{status.model ?? '—'}</dd>
          </div>
          {status.quota ? (
            <>
              <div>
                <dt className="text-muted-foreground">Cota da empresa hoje</dt>
                <dd className="font-medium tabular-nums">
                  {status.quota.tenant.used} de {status.quota.tenant.limit} pontos
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sua cota hoje</dt>
                <dd className="font-medium tabular-nums">
                  {status.quota.user.used} de {status.quota.user.limit} pontos
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function UsageCard() {
  const usage = useQuery({ queryKey: usageKey, queryFn: () => endpoints.ai.admin.usage() });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Uso do assistente</CardTitle>
        <CardDescription>
          Perguntas feitas e pontos (neurons) gastos. Os pontos são a cota diária do provedor; o dia
          vira à meia-noite UTC (21h em Brasília).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage.isPending ? <Skeleton className="h-24 w-full" /> : null}
        {usage.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(usage.error)}</AlertDescription>
          </Alert>
        ) : null}
        {usage.data ? (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Uso de hoje">
              <Stat label="Perguntas hoje" value={number.format(usage.data.today.questions)} />
              <Stat
                label="Pontos gastos hoje"
                value={number.format(usage.data.today.neurons)}
                hint={
                  usage.data.today.insights.used > 0
                    ? `Insights: ${number.format(usage.data.today.insights.used)} de ${number.format(usage.data.today.insights.limit)}`
                    : undefined
                }
              />
              <Stat
                label="Ainda cabem hoje"
                value={
                  usage.data.today.estimatedQuestionsLeft === null
                    ? '—'
                    : `~${number.format(usage.data.today.estimatedQuestionsLeft)} perguntas`
                }
                hint={
                  usage.data.today.averageNeuronsPerQuestion === null
                    ? 'Aparece depois das primeiras perguntas'
                    : `Média de ${number.format(usage.data.today.averageNeuronsPerQuestion)} pontos por pergunta`
                }
              />
              <Stat
                label="Plataforma hoje"
                value={`${number.format(usage.data.today.platform.used)} de ${number.format(usage.data.today.platform.limit)}`}
                hint="Teto diário que protege o plano grátis do provedor"
              />
            </dl>
            {usage.data.days.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum uso registrado.</p>
            ) : (
              <>
                <p className="text-sm">
                  Últimos 30 dias:{' '}
                  <strong className="tabular-nums">{usage.data.totals.questions}</strong> perguntas,{' '}
                  <strong className="tabular-nums">
                    {number.format(usage.data.totals.neurons)}
                  </strong>{' '}
                  pontos em <strong className="tabular-nums">{usage.data.totals.calls}</strong>{' '}
                  chamadas ao modelo ({usage.data.totals.failures} falhas).
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dia</TableHead>
                      <TableHead>Finalidade</TableHead>
                      <TableHead className="text-right">Perguntas</TableHead>
                      <TableHead className="text-right">Pontos</TableHead>
                      <TableHead className="text-right">Chamadas</TableHead>
                      <TableHead className="text-right">Falhas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.data.days.map((row) => (
                      <TableRow key={`${row.day}-${row.purpose}`}>
                        <TableCell>{formatDate(row.day)}</TableCell>
                        <TableCell>{PURPOSE_LABEL[row.purpose]}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.purpose === 'CHAT' ? row.questions : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {number.format(row.neurons)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.failures}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DiagnosticsCard() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<AiDiagnosticsDto | null>(null);
  const run = useMutation({
    mutationFn: () => endpoints.ai.admin.diagnostics(),
    onSuccess: async (data) => {
      setResult(data);
      await queryClient.invalidateQueries({ queryKey: ['ai'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Diagnóstico</CardTitle>
        <CardDescription>
          Faz uma chamada mínima ao modelo para conferir credencial, prazo e custo. Conta na cota.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Testando…' : 'Testar a IA'}
        </Button>
        {result ? (
          <Alert variant={result.ok ? 'default' : 'destructive'} role="status">
            <AlertDescription>
              {result.ok
                ? `Funcionou em ${result.durationMs} ms (${result.model ?? 'modelo'}, ${result.neurons ?? '?'} pontos).`
                : (result.message ?? 'A IA não respondeu.')}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InsightsRunCard() {
  const queryClient = useQueryClient();
  const run = useMutation({
    mutationFn: () => endpoints.ai.insights.run(),
    onSuccess: async (data) => {
      toast.success(
        `Rotina concluída: ${data.created} novos, ${data.updated} atualizados, ${data.resolved} resolvidos, ${data.written} redigidos pela IA.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['ai'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Insights do dia</CardTitle>
        <CardDescription>
          A rotina roda sozinha uma vez por dia e aparece no início de cada pessoa, conforme a
          permissão e a carteira. Aqui você pode rodar agora.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Rodando…' : 'Rodar a rotina agora'}
        </Button>
      </CardContent>
    </Card>
  );
}

const SAMPLE_FIELDS = [
  ['receivablesPaid', 'Parcelas pagas (previsão de recebimentos)'],
  ['funnelClosed', 'Oportunidades encerradas (previsão do funil)'],
  ['installationsDone', 'Instalações concluídas (previsão de conclusão)'],
  ['generationDays', 'Dias com leitura (previsão de geração)'],
  ['potentialClients', 'Clientes com margem (clientes com mais potencial)'],
  ['groupSize', 'Registros por grupo (rankings e comparações)'],
  ['simpleAverage', 'Registros para médias simples'],
] as const;

/** Mínimos de amostra e prazo de "parada": parâmetros da empresa (nunca norma). Abaixo do mínimo, o sistema diz "dados insuficientes". */
function AnalysisSettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['analytics', 'settings'],
    queryFn: () => endpoints.analyticsSettings.get(),
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  const save = useMutation({
    mutationFn: (input: Parameters<typeof endpoints.analyticsSettings.update>[0]) =>
      endpoints.analyticsSettings.update(input),
    onSuccess: async () => {
      toast.success('Parâmetros salvos');
      setEdits({});
      await queryClient.invalidateQueries({ queryKey: ['analytics'] });
      await queryClient.invalidateQueries({ queryKey: ['forecast'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (settings.isPending) return <Skeleton className="h-40 w-full" />;
  if (settings.isError) return null;
  const data = settings.data;
  const value = (key: string, current: number) => edits[key] ?? String(current);

  const submit = () => {
    const minSamples: Record<string, number> = {};
    for (const [key] of SAMPLE_FIELDS) {
      const n = Number(value(key, data.minSamples[key]));
      if (!Number.isInteger(n) || n < 3 || n > 1000)
        return setError('Os mínimos de amostra são números inteiros de 3 a 1.000.');
      minSamples[key] = n;
    }
    const stalled = Number(value('stalledDays', data.stalledDays));
    if (!Number.isInteger(stalled) || stalled < 3 || stalled > 180)
      return setError('Os dias para uma oportunidade ser dada como parada vão de 3 a 180.');
    setError(undefined);
    save.mutate({
      minSamples,
      stalledDays: stalled,
      bestClientShare: data.bestClientShare,
      bestClientCriterion: data.bestClientCriterion,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Parâmetros de análise e previsão</CardTitle>
        <CardDescription>
          Quantos registros a empresa exige antes de aceitar um número. Abaixo do mínimo o sistema
          mostra “dados insuficientes” em vez de arriscar.{' '}
          {data.usingDefaults
            ? 'Hoje valem os padrões do sistema, que são prudência estatística, não norma.'
            : 'Valores definidos pela sua empresa.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {SAMPLE_FIELDS.map(([key, label]) => (
            <div key={key} className="grid gap-1">
              <Label htmlFor={`min-${key}`}>{label}</Label>
              <Input
                id={`min-${key}`}
                inputMode="numeric"
                value={value(key, data.minSamples[key])}
                onChange={(e) => setEdits({ ...edits, [key]: e.target.value })}
              />
            </div>
          ))}
          <div className="grid gap-1">
            <Label htmlFor="min-stalled">Dias para uma oportunidade ser dada como parada</Label>
            <Input
              id="min-stalled"
              inputMode="numeric"
              value={value('stalledDays', data.stalledDays)}
              onChange={(e) => setEdits({ ...edits, stalledDays: e.target.value })}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar parâmetros'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function IntelligencePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inteligência</h1>
        <p className="text-sm text-muted-foreground">
          Ligue o assistente de IA da empresa e acompanhe o uso.
        </p>
      </div>
      <SettingsCard />
      <InsightsRunCard />
      <Can permission="platform.tenant.manage">
        <AnalysisSettingsCard />
      </Can>
      <UsageCard />
      <DiagnosticsCard />
    </div>
  );
}
