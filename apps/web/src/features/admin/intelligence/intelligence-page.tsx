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

function UsageCard() {
  const usage = useQuery({ queryKey: usageKey, queryFn: () => endpoints.ai.admin.usage() });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Uso dos últimos 30 dias</CardTitle>
        <CardDescription>
          Pontos (neurons) gastos, chamadas e falhas por dia e finalidade.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {usage.isPending ? <Skeleton className="h-24 w-full" /> : null}
        {usage.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(usage.error)}</AlertDescription>
          </Alert>
        ) : null}
        {usage.data ? (
          usage.data.days.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum uso registrado.</p>
          ) : (
            <>
              <p className="mb-3 text-sm">
                Total: <strong className="tabular-nums">{usage.data.totals.neurons}</strong> pontos
                em <strong className="tabular-nums">{usage.data.totals.calls}</strong> chamadas (
                {usage.data.totals.failures} falhas).
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia</TableHead>
                    <TableHead>Finalidade</TableHead>
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
                      <TableCell className="text-right tabular-nums">{row.neurons}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.calls}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.failures}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )
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
      <UsageCard />
      <DiagnosticsCard />
    </div>
  );
}
