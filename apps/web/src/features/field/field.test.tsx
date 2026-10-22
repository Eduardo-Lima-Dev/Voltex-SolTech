import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CommissioningTestDto,
  FieldActionInput,
  FieldCommissioningDto,
  FieldSyncResultDto,
  FieldWorkOrderDto,
} from '@voltex/shared';
import { API, makeSession } from '@/test/fixtures';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { FIELD_DB_NAME, openFieldDb } from './field-db';
import { endpoints } from '@/lib/api/endpoints';
import { fieldOrder } from './field-fixtures';
import { applyLocal } from './field-local';

const OPS = () => makeSession('INSTALLER');

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

interface Server {
  syncBodies: FieldActionInput[][];
  photos: FormData[];
  signatures: FormData[];
}

/**
 * Servidor de mentira com memória: aplica as ações recebidas às ordens, como o de verdade, para a tela ver o
 * resultado quando atualiza. Fotos e assinaturas passam por `endpoints.field` (o multipart do jsdom não atravessa o
 * fetch do Node), então ficam registradas em `photos` e `signatures`.
 */
function mockField(
  orders: FieldWorkOrderDto[] = [fieldOrder()],
  decide: (a: FieldActionInput) => FieldSyncResultDto['status'] = () => 'APPLIED',
  messageFor: (a: FieldActionInput) => string | null = () => null,
): Server {
  const state: Server = { syncBodies: [], photos: [], signatures: [] };
  let current = orders;
  server.use(
    http.get(`${API}/operations/field/work-orders`, () => HttpResponse.json(current)),
    http.post(`${API}/operations/field/sync`, async ({ request }) => {
      const body = (await request.json()) as { actions: FieldActionInput[] };
      state.syncBodies.push(body.actions);
      const results = body.actions.map((a) => {
        const status = decide(a);
        if (status === 'APPLIED')
          current = current.map((o) => (o.id === a.workOrderId ? applyLocal(o, a) : o));
        return { clientActionId: a.clientActionId, status, message: messageFor(a) };
      });
      return HttpResponse.json(results);
    }),
  );
  vi.spyOn(endpoints.field, 'uploadPhoto').mockImplementation(async (_id, form) => {
    state.photos.push(form);
    return { id: 'p-1' } as never;
  });
  vi.spyOn(endpoints.field, 'saveSignature').mockImplementation(async (_id, form) => {
    state.signatures.push(form);
    return { signedByName: 'x', signedAt: '2026-10-22T12:00:00.000Z' };
  });
  return state;
}

describe('App de campo', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    setOnline(true);
  });
  afterEach(() => {
    setOnline(true);
    vi.restoreAllMocks();
  });

  it('lista as ordens do técnico, a em execução primeiro, e mostra que está online', async () => {
    mockField([
      fieldOrder({ id: 'w-2', title: 'Visita de vistoria', type: 'VISIT', status: 'SCHEDULED' }),
      fieldOrder({ id: 'w-1', title: 'Instalar o sistema', status: 'IN_PROGRESS' }),
    ]);
    renderApp('/campo', { session: OPS() });
    const running = await screen.findByRole('list', { name: 'Ordens em execução' });
    expect(within(running).getByText('Instalar o sistema')).toBeInTheDocument();
    const scheduled = screen.getByRole('list', { name: 'Ordens agendadas' });
    expect(within(scheduled).getByText('Visita de vistoria')).toBeInTheDocument();
    expect(within(scheduled).getByText(/Rua das Flores/)).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('iniciar vale na hora, é enviado ao servidor com a posição e a ordem passa a "em execução"', async () => {
    const calls = mockField();
    renderApp('/campo/w-1', { session: OPS() });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Iniciar' }));
    expect(await screen.findByText('Em execução')).toBeInTheDocument();
    await waitFor(() => expect(calls.syncBodies.length).toBe(1));
    expect(calls.syncBodies[0]![0]).toMatchObject({ type: 'START', workOrderId: 'w-1' });
    expect(calls.syncBodies[0]![0]!.clientActionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('checklist: marcar um item envia a ação e fica marcado', async () => {
    const calls = mockField([fieldOrder({ status: 'IN_PROGRESS' })]);
    renderApp('/campo/w-1', { session: OPS() });
    const user = userEvent.setup();
    const checklist = await screen.findByRole('list', { name: 'Checklist' });
    const box = within(checklist).getByRole('checkbox', { name: 'Fixar a estrutura' });
    await user.click(box);
    expect(box).toBeChecked();
    await waitFor(() => expect(calls.syncBodies.length).toBe(1));
    expect(calls.syncBodies[0]![0]).toMatchObject({ type: 'CHECK', itemId: 'k-1', done: true });
  });

  it('sem internet nada é enviado, o aparelho avisa quantos itens esperam, e ao voltar a conexão tudo vai', async () => {
    const calls = mockField([fieldOrder({ status: 'IN_PROGRESS' })]);
    renderApp('/campo/w-1', { session: OPS() });
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Checklist' });
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('Sem internet')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Fixar a estrutura' }));
    await user.click(screen.getByRole('checkbox', { name: 'Ligar os módulos' }));
    expect(await screen.findByLabelText('2 item(ns) para enviar')).toBeInTheDocument();
    expect(calls.syncBodies).toHaveLength(0);
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(calls.syncBodies).toHaveLength(1));
    expect(calls.syncBodies[0]!.map((a) => a.type)).toEqual(['CHECK', 'CHECK']);
    await waitFor(() =>
      expect(screen.queryByLabelText(/item\(ns\) para enviar/)).not.toBeInTheDocument(),
    );
  });

  it('o que o servidor recusa aparece com a mensagem até a pessoa dispensar', async () => {
    mockField(
      [fieldOrder({ status: 'IN_PROGRESS' })],
      () => 'REJECTED',
      () => 'A ordem foi cancelada pela operação.',
    );
    renderApp('/campo/w-1', { session: OPS() });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Fixar a estrutura' }));
    const rejected = await screen.findByRole('list', { name: 'Itens recusados' });
    expect(within(rejected).getByText('A ordem foi cancelada pela operação.')).toBeInTheDocument();
    await user.click(within(rejected).getByRole('button', { name: 'Entendi' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Itens recusados' })).not.toBeInTheDocument(),
    );
  });

  it('registra pendência e anotação como ações', async () => {
    const calls = mockField([fieldOrder({ status: 'IN_PROGRESS' })]);
    renderApp('/campo/w-1', { session: OPS() });
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Checklist' });
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('O que aconteceu'), 'Telhado sem acesso');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(calls.syncBodies.flat().some((a) => a.type === 'ISSUE')).toBe(true));
    const issue = calls.syncBodies.flat().find((a) => a.type === 'ISSUE')!;
    expect(issue).toMatchObject({
      issueType: 'OTHER',
      description: 'Telhado sem acesso',
      blocking: true,
    });
    expect(await screen.findByText('Telhado sem acesso')).toBeInTheDocument();
    expect(screen.getByText(/bloqueia: o sistema só aceita concluir/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Anotação'), 'Cliente pediu para ligar antes');
    await user.click(screen.getByRole('button', { name: 'Salvar anotação' }));
    await waitFor(() => expect(calls.syncBodies.flat().some((a) => a.type === 'NOTE')).toBe(true));
  });

  it('concluir pede confirmação e envia a ação', async () => {
    const calls = mockField([fieldOrder({ status: 'IN_PROGRESS' })]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/campo/w-1', { session: OPS() });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Concluir ordem' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(calls.syncBodies.flat().some((a) => a.type === 'COMPLETE')).toBe(true),
    );
    expect(await screen.findByText('Concluída')).toBeInTheDocument();
  });

  it('foto: guarda no aparelho e envia com a chave de reenvio', async () => {
    const calls = mockField([fieldOrder({ status: 'IN_PROGRESS' })]);
    renderApp('/campo/w-1', { session: OPS() });
    const input = await screen.findByLabelText('Tirar ou escolher fotos');
    const file = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(calls.photos).toHaveLength(1));
    const form = calls.photos[0]!;
    expect(form.get('clientActionId')).toMatch(/^[0-9a-f-]{36}$/);
    expect(form.get('takenAt')).toEqual(expect.any(String));
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('assinatura: só com ordem em execução, exige desenho e nome, e é enviada em PNG', async () => {
    const calls = mockField([fieldOrder({ status: 'IN_PROGRESS' })]);
    const ctx = {
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
      cb(new Blob(['png'], { type: 'image/png' })),
    );
    renderApp('/campo/w-1', { session: OPS() });
    const user = userEvent.setup();
    const pad = await screen.findByRole('img', { name: 'Assinatura do cliente' });
    const save = screen.getByRole('button', { name: 'Guardar assinatura' });
    expect(save).toBeDisabled();
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(pad, { clientX: 40, clientY: 30 });
    fireEvent.pointerUp(pad);
    await user.type(screen.getByLabelText('Nome de quem assina'), 'Maria da Silva');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(calls.signatures).toHaveLength(1));
    expect(calls.signatures[0]!.get('signedByName')).toBe('Maria da Silva');
    expect((calls.signatures[0]!.get('file') as Blob).type).toBe('image/png');
  });

  it('ordem agendada não mostra assinatura; ordem que não está no aparelho explica o que fazer', async () => {
    mockField([fieldOrder()]);
    renderApp('/campo/w-1', { session: OPS() });
    await screen.findByRole('button', { name: 'Iniciar' });
    expect(screen.queryByText('Assinatura do cliente')).not.toBeInTheDocument();
  });

  it('ordem desconhecida avisa que não está neste aparelho', async () => {
    mockField([fieldOrder()]);
    renderApp('/campo/nao-existe', { session: OPS() });
    expect(await screen.findByText(/não está neste aparelho/)).toBeInTheDocument();
  });

  it('sem sessão mas com o perfil guardado no aparelho, o app abre com os dados e pede para entrar de novo', async () => {
    const db = await openFieldDb(FIELD_DB_NAME);
    await db.put(
      'meta',
      { userId: 'u-9', name: 'João Instalador', savedAt: '2026-10-22T12:00:00.000Z' },
      'profile',
    );
    await db.put('orders', { ...fieldOrder({ title: 'Instalar guardada' }), userId: 'u-9' });
    db.close();
    mockField();
    renderApp('/campo', { session: null });
    expect(await screen.findByText('Instalar guardada')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Sua sessão venceu/);
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
    expect(screen.getByText('João Instalador')).toBeInTheDocument();
  });

  it('sem sessão e sem perfil guardado, vai para o login', async () => {
    mockField();
    renderApp('/campo', { session: null });
    expect(await screen.findByRole('heading', { name: /Entrar/ })).toBeInTheDocument();
  });

  it('perfis sem acesso ao campo veem "Sem acesso"', async () => {
    mockField();
    renderApp('/campo', { session: makeSession('SALESPERSON') });
    expect(
      await screen.findByRole('heading', { name: 'Sem acesso a esta área' }),
    ).toBeInTheDocument();
  });
  describe('ensaios do comissionamento', () => {
    const base = (o: Partial<CommissioningTestDto> = {}): CommissioningTestDto => ({
      id: 'c-1',
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
    const iscTest = (o: Partial<CommissioningTestDto> = {}) =>
      base({
        id: 'c-2',
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
        electrical: {
          modulesInSeries: 10,
          vocStcV: 40,
          iscStcA: 10,
          betaVocPctPerC: -0.3,
          alphaIscPctPerC: 0.05,
        },
        ...o,
      });
    const commissioningOrder = (c: Partial<FieldCommissioningDto> = {}) =>
      fieldOrder({
        type: 'COMMISSIONING',
        status: 'IN_PROGRESS',
        title: 'Comissionamento',
        checklist: [],
        commissioning: {
          recordId: 'r-1',
          status: 'IN_PROGRESS',
          level: 'STANDARD',
          provisional: false,
          ruleNote: null,
          conditions: {},
          tests: [base(), iscTest()],
          ...c,
        },
      });

    it('mostra os ensaios por grupo; conferência e medição viram ações, com a prévia do julgamento na hora', async () => {
      const calls = mockField([commissioningOrder()]);
      renderApp('/campo/w-1', { session: OPS() });
      const user = userEvent.setup();
      const group = await screen.findByRole('list', { name: 'Categoria 1' });
      expect(within(group).getByText('Continuidade do aterramento')).toBeInTheDocument();
      expect(within(group).getByText('Inversor 1 · string 1')).toBeInTheDocument();

      // Conferência.
      await user.click(within(group).getByRole('button', { name: 'Conforme' }));
      await waitFor(() =>
        expect(
          calls.syncBodies
            .flat()
            .some((a) => a.type === 'MEASURE' && 'passed' in a && a.passed === true),
        ).toBe(true),
      );

      // Condições do local: o esperado passa a existir e a medição é julgada com a mesma conta do servidor.
      await user.type(screen.getByLabelText('Irradiância (W/m²)'), '800');
      await user.type(screen.getByLabelText('Temp. do módulo (°C)'), '25');
      await user.click(screen.getByRole('button', { name: 'Salvar condições' }));
      await waitFor(() =>
        expect(calls.syncBodies.flat().some((a) => a.type === 'CONDITIONS')).toBe(true),
      );
      await user.type(screen.getByLabelText(/Valor medido/), '7,9');
      await user.click(screen.getByRole('button', { name: /Registrar medição: Isc da string/ }));
      await waitFor(() =>
        expect(
          calls.syncBodies
            .flat()
            .some((a) => a.type === 'MEASURE' && 'value' in a && a.value === 7.9),
        ).toBe(true),
      );
      // 7,9 A contra 8 A esperados (−1,25 %), tolerância de 5 %: conforme.
      const isc = (await screen.findByText('Isc da string')).closest('li') as HTMLElement;
      expect(await within(isc).findByText('Conforme')).toBeInTheDocument();
      expect(within(isc).getByText(/Esperado: 8 A/)).toBeInTheDocument();
      expect(within(isc).getByText(/tolerância 5 %/)).toBeInTheDocument();
    });

    it('medição fora da tolerância aparece como reprovada; sem tolerância, "sem regra para julgar"', async () => {
      mockField([
        commissioningOrder({
          conditions: { irradianceWm2: 800, moduleTempC: 25 },
          tests: [
            iscTest({ measuredValue: 7.0, result: 'FAIL' }),
            iscTest({
              id: 'c-3',
              subjectLabel: 'Inversor 1 · string 2',
              tolerancePct: null,
              measuredValue: 8,
              result: 'PENDING_RULE',
              reason: 'A regra em vigor não define tolerância nem limite para este ensaio.',
            }),
          ],
        }),
      ]);
      renderApp('/campo/w-1', { session: OPS() });
      expect(await screen.findByText('Reprovado')).toBeInTheDocument();
      expect(screen.getByText('Sem regra para julgar')).toBeInTheDocument();
      expect(screen.getByText(/não define tolerância/)).toBeInTheDocument();
    });

    it('modelo provisório avisa; depois de enviado para revisão os campos ficam travados', async () => {
      mockField([
        commissioningOrder({
          provisional: true,
          status: 'SUBMITTED',
          ruleNote: 'Modelo-base provisório.',
        }),
      ]);
      renderApp('/campo/w-1', { session: OPS() });
      expect(await screen.findByRole('note')).toHaveTextContent(/Modelo provisório/);
      expect(screen.getByText(/enviado para revisão do responsável técnico/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Conforme' })).toBeDisabled();
      expect(screen.getByLabelText(/Valor medido/)).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Salvar condições' })).toBeDisabled();
    });

    it('ordem que não é de comissionamento não mostra a seção de ensaios', async () => {
      mockField([fieldOrder({ status: 'IN_PROGRESS' })]);
      renderApp('/campo/w-1', { session: OPS() });
      await screen.findByRole('list', { name: 'Checklist' });
      expect(screen.queryByText('Ensaios do comissionamento')).not.toBeInTheDocument();
    });
  });
});
