import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  COMMISSIONING_LEVELS,
  type CommissioningLevel,
  type CommissioningRecordDto,
  type CommissioningTestDto,
  type InstallationDetailDto,
} from '@voltex/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  toast,
} from '@voltex/ui';
import { Can } from '@/app/guards';
import { endpoints } from '@/lib/api/endpoints';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '../admin/query-keys';
import { RESULT_LABELS, RESULT_VARIANT } from '../field/field-commissioning';

const STATUS_LABELS = {
  IN_PROGRESS: 'Em andamento',
  SUBMITTED: 'Aguardando revisão',
  APPROVED: 'Aprovado',
  REJECTED: 'Reprovado',
} as const;

const LEVEL_LABELS: Record<CommissioningLevel, string> = {
  STANDARD: 'Padrão (categoria 1)',
  EXTENDED: 'Ampliado (categorias 1 e 2)',
};

const num = (text: string): number | null => {
  const n = Number(text.replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
};

const fmt = (value: number | null | undefined, digits = 2): string =>
  value === null || value === undefined
    ? '—'
    : value.toLocaleString('pt-BR', { maximumFractionDigits: digits });

function useRefresh(installationId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.commissioning(installationId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.installation(installationId) }),
      queryClient.invalidateQueries({ queryKey: ['operations', 'installations'] }),
    ]);
}

function TestDialog({
  test,
  onClose,
  onSaved,
}: {
  test: CommissioningTestDto | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [value, setValue] = useState(test?.measuredValue != null ? String(test.measuredValue) : '');
  const [note, setNote] = useState(test?.note ?? '');
  const [irradiance, setIrradiance] = useState('');
  const [moduleTemp, setModuleTemp] = useState('');
  const save = useMutation({
    mutationFn: (passed?: boolean) =>
      endpoints.operations.commissioning.recordTest(test!.id, {
        ...(test!.kind === 'MEASURE' ? { value: num(value) } : { passed: passed ?? null }),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(num(irradiance) !== null ? { irradianceWm2: num(irradiance)! } : {}),
        ...(num(moduleTemp) !== null ? { moduleTempC: num(moduleTemp)! } : {}),
      }),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar o ensaio.')),
  });
  return (
    <Dialog open={test !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{test?.label}</DialogTitle>
          <DialogDescription>{test?.subjectLabel}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {test?.kind === 'MEASURE' ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="ct-value">Valor medido{test.unit ? ` (${test.unit})` : ''}</Label>
                <Input
                  id="ct-value"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ct-g">Irradiância própria (W/m²)</Label>
                  <Input
                    id="ct-g"
                    inputMode="decimal"
                    value={irradiance}
                    onChange={(e) => setIrradiance(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ct-t">Temp. do módulo própria (°C)</Label>
                  <Input
                    id="ct-t"
                    inputMode="decimal"
                    value={moduleTemp}
                    onChange={(e) => setModuleTemp(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                As condições próprias só são necessárias se esta medição foi feita em condições
                diferentes das do registro.
              </p>
            </>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="ct-note">Observação</Label>
            <Input id="ct-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {test?.kind === 'CHECK' ? (
            <>
              <Button
                variant="destructive"
                disabled={save.isPending}
                onClick={() => save.mutate(false)}
              >
                Não conforme
              </Button>
              <Button disabled={save.isPending} onClick={() => save.mutate(true)}>
                Conforme
              </Button>
            </>
          ) : (
            <Button
              disabled={num(value) === null || save.isPending}
              onClick={() => save.mutate(undefined)}
            >
              Registrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({
  record,
  mode,
  onClose,
  onDone,
}: {
  record: CommissioningRecordDto;
  mode: 'APPROVE' | 'REJECT' | null;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: () =>
      endpoints.operations.commissioning.decide(record.id, {
        decision: mode!,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.success(
        mode === 'APPROVE' ? 'Comissionamento aprovado.' : 'Comissionamento reprovado.',
      );
      await onDone();
      onClose();
    },
    onError: (error) => {
      const blockers = isApiError(error)
        ? (error.data?.blockers as string[] | undefined)
        : undefined;
      toast.error(blockers?.join(' ') ?? errorMessage(error, 'Não foi possível decidir.'));
    },
  });
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'APPROVE' ? 'Aprovar o comissionamento' : 'Reprovar o comissionamento'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'APPROVE'
              ? 'Gera o relatório e abre o aceite do cliente. Você assume a conferência dos ensaios.'
              : 'A instalação volta a "em instalação" e uma nova tentativa abre quando for reinstalada.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="dec-note">Observação{mode === 'REJECT' ? '' : ' (opcional)'}</Label>
          <Input id="dec-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant={mode === 'REJECT' ? 'destructive' : 'default'}
            disabled={decide.isPending || (mode === 'REJECT' && note.trim().length < 3)}
            onClick={() => decide.mutate()}
          >
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordView({
  installationId,
  record,
}: {
  installationId: string;
  record: CommissioningRecordDto;
}) {
  const refresh = useRefresh(installationId);
  const [editing, setEditing] = useState<CommissioningTestDto | null>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [irradiance, setIrradiance] = useState('');
  const [moduleTemp, setModuleTemp] = useState('');
  const [ambient, setAmbient] = useState('');
  const [strings, setStrings] = useState('');
  const open = record.status === 'IN_PROGRESS';
  const hasResults = record.tests.some((t) => t.result !== 'PENDING' || t.note);
  const groups = [...new Set(record.tests.map((t) => t.group))];

  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível concluir a ação.')),
  });
  const c = record.conditions;
  const report = useMutation({
    mutationFn: () => endpoints.operations.commissioning.reportUrl(record.id),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível abrir o relatório.')),
  });

  return (
    <div className="space-y-4">
      {record.provisional ? (
        <p
          role="note"
          className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100"
        >
          <strong>Modelo provisório.</strong> {record.ruleNote} A aprovação fica travada até haver
          uma regra <code>ops.commissioning</code> ativa e revisada (Administração → Regras).
        </p>
      ) : null}
      {record.internalTestRule ? (
        <p
          role="note"
          className="rounded-md bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          Regra de <strong>teste interno</strong> (valores de exemplo, não revisados). Não use em
          obra real.
        </p>
      ) : null}
      {[
        ...record.notes,
        ...record.skipped.map((s) => `Ensaio ${s.code} não gerado: ${s.reason}.`),
      ].map((n) => (
        <p key={n} className="text-xs text-muted-foreground">
          • {n}
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge
          variant={
            record.status === 'APPROVED'
              ? 'green'
              : record.status === 'REJECTED'
                ? 'red'
                : 'secondary'
          }
        >
          {STATUS_LABELS[record.status]}
        </Badge>
        <span>Tentativa {record.attempt}</span>
        <span className="text-muted-foreground">· regra {record.ruleRef}</span>
        {record.ruleReviewedBy ? (
          <span className="text-muted-foreground">· revisada por {record.ruleReviewedBy}</span>
        ) : null}
      </div>

      <Can permission="ops.commissioning.write">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cm-level">Nível</Label>
            <NativeSelect
              id="cm-level"
              value={record.level}
              disabled={!open || hasResults}
              onChange={(e) =>
                act.mutate(() =>
                  endpoints.operations.commissioning.update(record.id, {
                    level: e.target.value as CommissioningLevel,
                  }),
                )
              }
            >
              {COMMISSIONING_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </Can>

      <section aria-label="Condições da medição" className="space-y-2">
        <h3 className="text-sm font-semibold">Condições da medição</h3>
        <p className="text-sm text-muted-foreground">
          Irradiância {fmt(c.irradianceWm2, 0)} W/m² · módulo {fmt(c.moduleTempC, 1)} °C · ambiente{' '}
          {fmt(c.ambientC, 1)} °C
        </p>
        <Can permission="ops.commissioning.write">
          {open ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor="cm-g" className="text-xs">
                  Irradiância (W/m²)
                </Label>
                <Input
                  id="cm-g"
                  className="w-28"
                  inputMode="decimal"
                  value={irradiance}
                  onChange={(e) => setIrradiance(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="cm-t" className="text-xs">
                  Temp. do módulo (°C)
                </Label>
                <Input
                  id="cm-t"
                  className="w-28"
                  inputMode="decimal"
                  value={moduleTemp}
                  onChange={(e) => setModuleTemp(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="cm-a" className="text-xs">
                  Temp. ambiente (°C)
                </Label>
                <Input
                  id="cm-a"
                  className="w-28"
                  inputMode="decimal"
                  value={ambient}
                  onChange={(e) => setAmbient(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  act.isPending ||
                  (num(irradiance) === null && num(moduleTemp) === null && num(ambient) === null)
                }
                onClick={() => {
                  act.mutate(() =>
                    endpoints.operations.commissioning.update(record.id, {
                      conditions: {
                        ...(num(irradiance) !== null ? { irradianceWm2: num(irradiance) } : {}),
                        ...(num(moduleTemp) !== null ? { moduleTempC: num(moduleTemp) } : {}),
                        ...(num(ambient) !== null ? { ambientC: num(ambient) } : {}),
                      },
                    }),
                  );
                  setIrradiance('');
                  setModuleTemp('');
                  setAmbient('');
                }}
              >
                Salvar condições
              </Button>
            </div>
          ) : null}
        </Can>
      </section>

      <p className="text-sm" aria-label="Resumo dos ensaios">
        {record.summary.total} ensaios · {record.summary.counts.PASS} conformes ·{' '}
        {record.summary.counts.FAIL} reprovados · {record.summary.unjudged} sem juízo ·{' '}
        {record.summary.counts.PENDING} sem registro
      </p>

      {groups.map((group) => (
        <details key={group} open className="rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">{group}</summary>
          <ul className="divide-y" aria-label={group}>
            {record.tests
              .filter((t) => t.group === group)
              .map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.subjectLabel}
                      {t.required ? '' : ' · opcional'}
                    </div>
                    {t.kind === 'MEASURE' && t.measuredValue !== null ? (
                      <div className="text-xs">
                        Medido {fmt(t.measuredValue)} {t.unit}
                        {t.expectedValue !== null
                          ? ` · esperado ${fmt(t.expectedValue)} ${t.unit}`
                          : ''}
                        {t.deviationPct !== null ? ` · desvio ${fmt(t.deviationPct, 1)} %` : ''}
                      </div>
                    ) : null}
                    {t.reason && t.result !== 'PASS' ? (
                      <div className="text-xs text-destructive">{t.reason}</div>
                    ) : null}
                    {t.note ? (
                      <div className="text-xs italic text-muted-foreground">Obs.: {t.note}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={RESULT_VARIANT[t.result]}>{RESULT_LABELS[t.result]}</Badge>
                    <Can permission="ops.commissioning.write">
                      {open ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Registrar: ${t.label} – ${t.subjectLabel}`}
                          onClick={() => setEditing(t)}
                        >
                          Registrar
                        </Button>
                      ) : null}
                    </Can>
                  </div>
                </li>
              ))}
          </ul>
        </details>
      ))}

      <Can permission="ops.commissioning.write">
        {open ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="cm-strings" className="text-xs">
                Acrescentar strings (uma por linha ou separadas por vírgula)
              </Label>
              <Input
                id="cm-strings"
                className="w-72"
                value={strings}
                onChange={(e) => setStrings(e.target.value)}
                placeholder="String 1, String 2"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending || !strings.trim()}
              onClick={() => {
                const labels = strings
                  .split(/[\n,;]/)
                  .map((x) => x.trim())
                  .filter(Boolean);
                act.mutate(() =>
                  endpoints.operations.commissioning.addStrings(record.id, { labels }),
                );
                setStrings('');
              }}
            >
              Acrescentar
            </Button>
          </div>
        ) : null}
      </Can>

      {record.blockers.length > 0 && record.status === 'SUBMITTED' ? (
        <div role="alert" className="rounded-md border border-destructive p-3 text-sm">
          <div className="font-semibold">Não dá para aprovar ainda:</div>
          <ul className="ml-4 list-disc">
            {record.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {record.decisionNote ? <p className="text-sm">Decisão: {record.decisionNote}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Can permission="ops.commissioning.write">
          {open ? (
            <Button
              disabled={act.isPending}
              onClick={() => act.mutate(() => endpoints.operations.commissioning.submit(record.id))}
            >
              Enviar para revisão
            </Button>
          ) : null}
        </Can>
        <Can permission="ops.commissioning.approve">
          {record.status === 'SUBMITTED' ? (
            <>
              <Button onClick={() => setDecision('APPROVE')}>Aprovar</Button>
              <Button variant="destructive" onClick={() => setDecision('REJECT')}>
                Reprovar
              </Button>
            </>
          ) : null}
        </Can>
        {record.hasReport ? (
          <Button variant="outline" disabled={report.isPending} onClick={() => report.mutate()}>
            Relatório (PDF)
          </Button>
        ) : null}
      </div>

      <TestDialog
        key={editing?.id ?? 'none'}
        test={editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
      <DecisionDialog
        key={decision ?? 'none'}
        record={record}
        mode={decision}
        onClose={() => setDecision(null)}
        onDone={refresh}
      />
    </div>
  );
}

/** Comissionamento da instalação: ensaios, condições, revisão do responsável técnico e relatório. */
export function CommissioningSection({ installation }: { installation: InstallationDetailDto }) {
  const refresh = useRefresh(installation.id);
  const relevant = ['INSTALLED', 'COMMISSIONING', 'CUSTOMER_ACCEPTANCE', 'DONE'].includes(
    installation.status,
  );
  // Antes da instalação concluída não há comissionamento: nem consulta.
  const query = useQuery({
    queryKey: queryKeys.commissioning(installation.id),
    queryFn: () => endpoints.operations.commissioning.forInstallation(installation.id),
    enabled: relevant,
  });
  const open = useMutation({
    mutationFn: () => endpoints.operations.commissioning.open(installation.id),
    onSuccess: refresh,
    onError: (error) =>
      toast.error(errorMessage(error, 'Não foi possível abrir o comissionamento.')),
  });
  if (!relevant) return null;
  const current = query.data?.current ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comissionamento</CardTitle>
        <CardDescription>
          Ensaios em campo, conferência e aprovação do responsável técnico. As tolerâncias vêm da
          regra revisada: o sistema não presume nenhuma.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : current ? (
          <RecordView installationId={installation.id} record={current} />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">O comissionamento ainda não foi aberto.</p>
            <Can permission="ops.commissioning.write">
              {['INSTALLED', 'COMMISSIONING'].includes(installation.status) ? (
                <Button disabled={open.isPending} onClick={() => open.mutate()}>
                  Abrir comissionamento
                </Button>
              ) : null}
            </Can>
          </div>
        )}
        {(query.data?.previous.length ?? 0) > 0 ? (
          <div>
            <h3 className="text-sm font-semibold">Tentativas anteriores</h3>
            <ul className="text-sm text-muted-foreground" aria-label="Tentativas anteriores">
              {query.data?.previous.map((p) => (
                <li key={p.id}>
                  Tentativa {p.attempt}: {STATUS_LABELS[p.status]}
                  {p.decidedAt ? ` em ${formatDateTime(p.decidedAt)}` : ''}
                  {p.decisionNote ? ` · ${p.decisionNote}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Aceite do cliente: registro (nome, canal e, se houver, a assinatura de campo). Não é assinatura eletrônica. */
export function AcceptanceSection({ installation }: { installation: InstallationDetailDto }) {
  const refresh = useRefresh(installation.id);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [orderId, setOrderId] = useState('');
  const signed = installation.workOrders.filter((o) => o.signedAt);
  const register = useMutation({
    mutationFn: () =>
      endpoints.operations.acceptance(installation.id, {
        acceptedByName: name.trim(),
        channel: orderId ? 'FIELD' : 'OFFICE',
        ...(orderId ? { workOrderId: orderId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.success('Aceite registrado. A instalação foi finalizada.');
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error, 'Não foi possível registrar o aceite.')),
  });
  if (installation.acceptance)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Aceite do cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            Aceito por <strong>{installation.acceptance.acceptedByName}</strong> em{' '}
            {formatDateTime(installation.acceptance.acceptedAt)} (
            {installation.acceptance.channel === 'FIELD'
              ? 'assinatura em campo'
              : installation.acceptance.channel === 'PORTAL'
                ? 'portal do cliente'
                : 'registro do escritório'}
            ).
          </p>
          {installation.acceptance.note ? (
            <p className="text-muted-foreground">{installation.acceptance.note}</p>
          ) : null}
        </CardContent>
      </Card>
    );
  if (installation.status !== 'CUSTOMER_ACCEPTANCE') return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aceite do cliente</CardTitle>
        <CardDescription>
          O comissionamento foi aprovado. Registre o aceite (nome de quem aceitou); é um registro,
          não uma assinatura eletrônica.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Can permission="ops.installation.write">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="acc-name">Nome de quem aceitou</Label>
              <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="acc-order">Assinatura colhida em campo</Label>
              <NativeSelect
                id="acc-order"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              >
                <option value="">Sem assinatura (registro do escritório)</option>
                {signed.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title} – {o.signedByName}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="acc-note">Observação</Label>
              <Input id="acc-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <Button
            disabled={name.trim().length < 2 || register.isPending}
            onClick={() => register.mutate()}
          >
            Registrar aceite
          </Button>
        </Can>
      </CardContent>
    </Card>
  );
}
