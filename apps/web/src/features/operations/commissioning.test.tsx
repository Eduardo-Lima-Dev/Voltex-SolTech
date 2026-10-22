import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CommissioningRecordDto,
  CommissioningTestDto,
  InstallationDetailDto,
} from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const now = '2026-10-22T12:00:00.000Z';

const test_ = (o: Partial<CommissioningTestDto> = {}): CommissioningTestDto => ({
  id: 't-1',
  position: 0,
  code: 'GROUND_CONTINUITY',
  label: 'Continuidade do aterramento',
  group: 'Categoria 1',
  kind: 'CHECK',
  level: 'STANDARD',
  scope: 'SYSTEM',
  unit: null,
  expectedKind: 'NONE',
  tolerancePct: null,
  min: null,
  max: null,
  required: true,
  source: 'Regra',
  subjectKey: 'system',
  subjectLabel: 'Sistema',
  electrical: null,
  result: 'PENDING',
  measuredValue: null,
  passed: null,
  expectedValue: null,
  deviationPct: null,
  basis: null,
  reason: null,
  note: null,
  conditions: null,
  measuredAt: null,
  measuredById: null,
  evidencePhotoIds: [],
  ...o,
});

const isc = (o: Partial<CommissioningTestDto> = {}) =>
  test_({
    id: 't-2',
    position: 1,
    code: 'STRING_ISC',
    label: 'Isc da string',
    kind: 'MEASURE',
    scope: 'STRING',
    unit: 'A',
    expectedKind: 'ISC_STRING',
    tolerancePct: 5,
    subjectKey: 'str:1',
    subjectLabel: 'Inversor 1 · string 1',
    ...o,
  });

const record = (o: Partial<CommissioningRecordDto> = {}): CommissioningRecordDto => ({
  id: 'r-1',
  installationId: 'i-1',
  attempt: 1,
  status: 'IN_PROGRESS',
  level: 'STANDARD',
  ruleRef: 'regra-1@2',
  provisional: false,
  ruleNote: null,
  ruleReviewedBy: 'Eng. Teste',
  internalTestRule: false,
  conditions: {},
  skipped: [],
  notes: [],
  startedAt: now,
  submittedAt: null,
  decidedAt: null,
  decidedById: null,
  decisionNote: null,
  hasReport: false,
  summary: {
    total: 2,
    counts: { PENDING: 2, PENDING_RULE: 0, PENDING_DATA: 0, PASS: 0, FAIL: 0, NOT_APPLICABLE: 0 },
    requiredPending: 2,
    failed: 0,
    unjudged: 0,
  },
  blockers: [],
  tests: [test_(), isc()],
  ...o,
});

const detail = (o: Partial<InstallationDetailDto> = {}): InstallationDetailDto => ({
  id: 'i-1',
  projectId: 'p-1',
  projectCode: 'PRJ-2026-0001',
  opportunityId: 'o-1',
  accountId: 'a-1',
  accountName: 'Maria da Silva',
  siteLabel: null,
  status: 'COMMISSIONING',
  responsibleId: null,
  materialsTotal: 0,
  materialsReady: 0,
  openIssues: 0,
  nextScheduledStart: null,
  createdAt: now,
  engineeringSnapshotId: null,
  projectStatus: 'APPROVED',
  materialsGeneratedAt: null,
  materialsReadyAt: null,
  installedAt: now,
  doneAt: null,
  cancelReason: null,
  acceptance: null,
  allowedTransitions: [],
  materials: [],
  workOrders: [],
  issues: [],
  history: [],
  ...o,
});

function mockInstallation(
  inst: InstallationDetailDto,
  current: CommissioningRecordDto | null,
  previous: unknown[] = [],
) {
  server.use(
    http.get(`${API}/operations/installations/i-1`, () => HttpResponse.json(inst)),
    http.get(`${API}/operations/installations/i-1/commissioning`, () =>
      HttpResponse.json({ current, previous }),
    ),
  );
}

describe('Operação · comissionamento e aceite', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sem registro: a operação abre o comissionamento; o líder técnico (só aprova) não vê o botão', async () => {
    let opened = 0;
    mockInstallation(detail({ status: 'INSTALLED' }), null);
    server.use(
      http.post(`${API}/operations/installations/i-1/commissioning`, () => {
        opened += 1;
        return HttpResponse.json(record());
      }),
    );
    const view = renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Abrir comissionamento' }));
    await waitFor(() => expect(opened).toBe(1));
    view.unmount();
    mockInstallation(detail({ status: 'INSTALLED' }), null);
    renderApp('/operations/instalacoes/i-1', { session: makeSession('TECHNICAL_LEAD') });
    expect(await screen.findByText('O comissionamento ainda não foi aberto.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir comissionamento' })).not.toBeInTheDocument();
  });

  it('modelo provisório e regra de teste aparecem como aviso; mostra o resumo, os grupos e os ensaios', async () => {
    mockInstallation(
      detail(),
      record({
        provisional: true,
        ruleNote: 'Modelo-base provisório: só a estrutura do livro.',
        internalTestRule: true,
        notes: ['A venda não veio de um projeto técnico aprovado.'],
        skipped: [{ code: 'STRING_ISC', reason: 'o projeto não tem strings' }],
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    expect(await screen.findByText(/Modelo provisório\./)).toBeInTheDocument();
    expect(screen.getByText(/ativa e revisada/)).toBeInTheDocument();
    expect(screen.getByText(/teste interno/)).toBeInTheDocument();
    expect(screen.getByText(/A venda não veio de um projeto técnico aprovado/)).toBeInTheDocument();
    expect(
      screen.getByText(/Ensaio STRING_ISC não gerado: o projeto não tem strings/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Resumo dos ensaios')).toHaveTextContent('2 ensaios');
    const group = screen.getByRole('list', { name: 'Categoria 1' });
    expect(within(group).getByText('Continuidade do aterramento')).toBeInTheDocument();
    expect(within(group).getByText('Isc da string')).toBeInTheDocument();
  });

  it('registra uma conferência e uma medição, e as condições', async () => {
    const bodies: Record<string, unknown> = {};
    mockInstallation(detail(), record());
    server.use(
      http.patch(`${API}/operations/commissioning/tests/:id`, async ({ request, params }) => {
        bodies[String(params.id)] = await request.json();
        return HttpResponse.json(test_());
      }),
      http.patch(`${API}/operations/commissioning/r-1`, async ({ request }) => {
        bodies.record = await request.json();
        return HttpResponse.json(record());
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Registrar: Continuidade do aterramento – Sistema',
      }),
    );
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Observação'), 'Cabo conferido');
    await user.click(within(dialog).getByRole('button', { name: 'Conforme' }));
    await waitFor(() => expect(bodies['t-1']).toEqual({ passed: true, note: 'Cabo conferido' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(
      screen.getByRole('button', { name: 'Registrar: Isc da string – Inversor 1 · string 1' }),
    );
    dialog = await screen.findByRole('dialog');
    const register = within(dialog).getByRole('button', { name: 'Registrar' });
    expect(register).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Valor medido/), '7,9');
    await user.type(within(dialog).getByLabelText(/Irradiância própria/), '650');
    await user.click(register);
    await waitFor(() => expect(bodies['t-2']).toEqual({ value: 7.9, irradianceWm2: 650 }));

    await user.type(screen.getByLabelText('Irradiância (W/m²)'), '800');
    await user.type(screen.getByLabelText('Temp. do módulo (°C)'), '45,5');
    await user.click(screen.getByRole('button', { name: 'Salvar condições' }));
    await waitFor(() =>
      expect(bodies.record).toEqual({ conditions: { irradianceWm2: 800, moduleTempC: 45.5 } }),
    );
  });

  it('o nível só muda antes de haver resultado', async () => {
    mockInstallation(detail(), record({ tests: [test_({ result: 'PASS', passed: true })] }));
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    expect(await screen.findByLabelText('Nível')).toBeDisabled();
  });

  it('enviar para revisão e acrescentar strings à mão', async () => {
    let submitted = 0;
    let added: unknown;
    mockInstallation(detail(), record());
    server.use(
      http.post(`${API}/operations/commissioning/r-1/submit`, () => {
        submitted += 1;
        return HttpResponse.json(record({ status: 'SUBMITTED' }));
      }),
      http.post(`${API}/operations/commissioning/r-1/strings`, async ({ request }) => {
        added = await request.json();
        return HttpResponse.json(record());
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Acrescentar strings/), 'String A, String B');
    await user.click(screen.getByRole('button', { name: 'Acrescentar' }));
    await waitFor(() => expect(added).toEqual({ labels: ['String A', 'String B'] }));
    await user.click(screen.getByRole('button', { name: 'Enviar para revisão' }));
    await waitFor(() => expect(submitted).toBe(1));
  });

  it('o responsável técnico vê as travas, reprova com motivo e aprova quando liberado; abre o relatório', async () => {
    const decisions: unknown[] = [];
    mockInstallation(
      detail(),
      record({
        status: 'SUBMITTED',
        blockers: ['1 ensaio(s) reprovado(s).'],
        tests: [test_({ result: 'FAIL', reason: 'Marcado como não conforme' })],
      }),
    );
    server.use(
      http.post(`${API}/operations/commissioning/r-1/decision`, async ({ request }) => {
        decisions.push(await request.json());
        return HttpResponse.json(record({ status: 'REJECTED' }));
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('TECHNICAL_LEAD') });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('1 ensaio(s) reprovado(s).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar para revisão' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reprovar' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Observação/), 'Isolamento baixo');
    await user.click(confirm);
    await waitFor(() =>
      expect(decisions).toEqual([{ decision: 'REJECT', note: 'Isolamento baixo' }]),
    );
  });

  it('aprovado: mostra o relatório; o operador não decide', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mockInstallation(
      detail({ status: 'CUSTOMER_ACCEPTANCE' }),
      record({ status: 'APPROVED', hasReport: true, decisionNote: 'Conforme' }),
    );
    server.use(
      http.get(`${API}/operations/commissioning/r-1/report`, () =>
        HttpResponse.json({ url: 'https://files.test/relatorio.pdf', expiresIn: 300 }),
      ),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Relatório (PDF)' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://files.test/relatorio.pdf', '_blank', 'noopener'),
    );
    expect(screen.getByText('Decisão: Conforme')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
  });

  it('mostra as tentativas anteriores', async () => {
    mockInstallation(detail(), record({ attempt: 2 }), [
      { id: 'r-0', attempt: 1, status: 'REJECTED', decidedAt: now, decisionNote: 'Corrente baixa' },
    ]);
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    const list = await screen.findByRole('list', { name: 'Tentativas anteriores' });
    expect(within(list).getByText(/Tentativa 1: Reprovado/)).toBeInTheDocument();
    expect(within(list).getByText(/Corrente baixa/)).toBeInTheDocument();
  });

  it('aceite: registro do escritório ou com a assinatura colhida em campo; depois mostra quem aceitou', async () => {
    const bodies: unknown[] = [];
    mockInstallation(
      detail({
        status: 'CUSTOMER_ACCEPTANCE',
        workOrders: [
          {
            id: 'w-1',
            installationId: 'i-1',
            projectCode: null,
            accountId: null,
            accountName: null,
            siteLabel: null,
            type: 'COMMISSIONING',
            status: 'DONE',
            title: 'Comissionamento',
            notes: null,
            crewId: null,
            crewName: null,
            assigneeId: null,
            scheduledStart: null,
            scheduledEnd: null,
            startedAt: null,
            completedAt: null,
            cancelReason: null,
            checklist: [],
            signedByName: 'Maria da Silva',
            signedAt: now,
            photoCount: 0,
            conflictsWith: [],
          },
        ],
      }),
      record({ status: 'APPROVED' }),
    );
    server.use(
      http.post(`${API}/operations/installations/i-1/acceptance`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(detail({ status: 'DONE' }));
      }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    const user = userEvent.setup();
    const register = await screen.findByRole('button', { name: 'Registrar aceite' });
    expect(register).toBeDisabled();
    await user.type(screen.getByLabelText('Nome de quem aceitou'), 'Maria da Silva');
    await user.click(register);
    await waitFor(() =>
      expect(bodies[0]).toEqual({ acceptedByName: 'Maria da Silva', channel: 'OFFICE' }),
    );
    await user.selectOptions(screen.getByLabelText('Assinatura colhida em campo'), 'w-1');
    await user.click(screen.getByRole('button', { name: 'Registrar aceite' }));
    await waitFor(() =>
      expect(bodies[1]).toEqual({
        acceptedByName: 'Maria da Silva',
        channel: 'FIELD',
        workOrderId: 'w-1',
      }),
    );
  });

  it('instalação finalizada mostra o aceite registrado', async () => {
    mockInstallation(
      detail({
        status: 'DONE',
        acceptance: {
          acceptedAt: now,
          acceptedByName: 'João Cliente',
          channel: 'FIELD',
          note: 'Tudo certo',
          hasSignature: true,
        },
      }),
      record({ status: 'APPROVED' }),
    );
    renderApp('/operations/instalacoes/i-1', { session: makeSession('OPERATIONS') });
    expect(await screen.findByText('João Cliente')).toBeInTheDocument();
    expect(screen.getByText(/assinatura em campo/)).toBeInTheDocument();
    expect(screen.getByText('Tudo certo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar aceite' })).not.toBeInTheDocument();
  });
});
