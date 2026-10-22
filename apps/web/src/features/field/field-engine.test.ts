import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldActionInput, FieldSyncResultDto } from '@voltex/shared';
import { ApiError } from '@/lib/api/errors';
import { FieldEngine } from './field-engine';
import { openFieldDb, type FieldDb } from './field-db';
import { fieldOrder, NOW } from './field-fixtures';

let dbCounter = 0;
const user = { id: 'u-1', name: 'João Instalador' };

function setup(options: { online?: boolean } = {}) {
  let online = options.online ?? true;
  let seq = 0;
  const ids = () => `0190a1b2-c3d4-7e5f-8a9b-${String(++seq).padStart(12, '0')}`;
  const orders = vi.fn<() => Promise<ReturnType<typeof fieldOrder>[]>>(async () => [fieldOrder()]);
  const sync = vi.fn<(actions: FieldActionInput[]) => Promise<FieldSyncResultDto[]>>(
    async (actions) =>
      actions.map((a) => ({
        clientActionId: a.clientActionId,
        status: 'APPLIED' as const,
        message: null,
      })),
  );
  const uploadPhoto = vi.fn<(id: string, form: FormData) => Promise<unknown>>(async () => ({}));
  const saveSignature = vi.fn<(id: string, form: FormData) => Promise<unknown>>(async () => ({}));
  let clock = Date.parse(NOW);
  const make = async (): Promise<{ engine: FieldEngine; db: FieldDb }> => {
    const db = await openFieldDb(`field-test-${++dbCounter}`);
    const engine = new FieldEngine({
      db,
      endpoints: { field: { orders, sync, uploadPhoto, saveSignature } as never },
      isOnline: () => online,
      now: () => new Date((clock += 1000)),
      uuid: ids,
      position: async () => ({ latitude: -15.79, longitude: -47.88, accuracy: 10 }),
    });
    return { engine, db };
  };
  return {
    make,
    orders,
    sync,
    uploadPhoto,
    saveSignature,
    setOnline: (v: boolean) => {
      online = v;
    },
  };
}

/** Espera o envio em andamento terminar (sem disparar outro). */
const settle = async (engine: FieldEngine) => {
  await vi.waitFor(() => expect(engine.getState().syncing).toBe(false));
};

describe('motor do app de campo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('baixa as ordens do técnico, guarda no aparelho e mostra por data', async () => {
    const s = setup();
    s.orders.mockResolvedValue([
      fieldOrder({ id: 'w-2', scheduledStart: '2026-10-24T12:00:00.000Z' }),
      fieldOrder({ id: 'w-1' }),
    ]);
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    expect(engine.getState().orders.map((o) => o.id)).toEqual(['w-1', 'w-2']);
    expect(engine.getState().lastSyncAt).not.toBeNull();
    // Reabrir o app (outro motor, mesmo banco) encontra as ordens sem internet.
    const state = engine.getState();
    expect(state.pending).toBe(0);
  });

  it('sem internet a ação vale na hora, fica na fila e é enviada quando a conexão volta', async () => {
    const s = setup({ online: false });
    const { engine } = await s.make();
    await engine.setUser(user);
    // Sem internet não há como baixar: simula a cópia guardada antes de ficar offline.
    s.setOnline(true);
    engine.setOnline(true);
    s.sync.mockClear();
    await engine.refresh();
    s.setOnline(false);
    engine.setOnline(false);

    await engine.act('w-1', { type: 'START' });
    await engine.act('w-1', { type: 'CHECK', itemId: 'k-1', done: true });
    const during = engine.getState();
    expect(during.orders[0]).toMatchObject({ status: 'IN_PROGRESS', pendingActions: 2 });
    expect(during.orders[0]!.checklist[0]!.done).toBe(true);
    expect(during.pending).toBe(2);
    expect(s.sync).not.toHaveBeenCalled();

    s.orders.mockResolvedValue([fieldOrder({ status: 'IN_PROGRESS', startedAt: NOW })]);
    s.setOnline(true);
    engine.setOnline(true);
    await vi.waitFor(() => expect(s.sync).toHaveBeenCalledTimes(1));
    await settle(engine);
    const sent = s.sync.mock.calls[0]![0];
    expect(sent.map((a) => a.type)).toEqual(['START', 'CHECK']);
    // O que vai ao servidor não leva os campos de controle do aparelho.
    expect(Object.keys(sent[0]!)).not.toContain('userId');
    expect(Object.keys(sent[0]!)).not.toContain('status');
    expect((sent[0] as { geo?: unknown }).geo).toEqual({
      latitude: -15.79,
      longitude: -47.88,
      accuracy: 10,
    });
    expect(engine.getState().pending).toBe(0);
    expect(engine.getState().orders[0]!.pendingActions).toBe(0);
  });

  it('o que o servidor recusa fica na fila marcado, com a mensagem, até a pessoa dispensar', async () => {
    const s = setup();
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    s.sync.mockImplementationOnce(async (actions) => [
      {
        clientActionId: actions[0]!.clientActionId,
        status: 'REJECTED',
        message: 'A ordem foi cancelada.',
      },
    ]);
    await engine.act('w-1', { type: 'START' });
    await vi.waitFor(() => expect(engine.getState().rejected).toBe(1));
    await settle(engine);
    const order = engine.getState().orders[0]!;
    expect(order.rejectedActions[0]).toMatchObject({
      status: 'REJECTED',
      message: 'A ordem foi cancelada.',
    });
    expect(order.pendingActions).toBe(0);
    // Uma ação recusada não é reenviada.
    s.sync.mockClear();
    await engine.flush();
    expect(s.sync).not.toHaveBeenCalled();
    await engine.dismiss(order.rejectedActions[0]!.clientActionId);
    expect(engine.getState().rejected).toBe(0);
  });

  it('falha de rede mantém tudo na fila e a próxima tentativa envia; envio repetido é aceito como duplicado', async () => {
    const s = setup();
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    s.sync.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'sem rede'));
    await engine.act('w-1', { type: 'NOTE', text: 'Chegamos' });
    await vi.waitFor(() => expect(engine.getState().error).toMatch(/Sem conexão/));
    await settle(engine);
    expect(engine.getState().pending).toBe(1);
    s.sync.mockImplementationOnce(async (actions) =>
      actions.map((a) => ({
        clientActionId: a.clientActionId,
        status: 'DUPLICATE' as const,
        message: null,
      })),
    );
    await engine.flush();
    await settle(engine);
    expect(engine.getState().pending).toBe(0);
    expect(engine.getState().error).toBeNull();
  });

  it('erro de servidor (5xx) mantém na fila; erro de formato (422) recusa em vez de insistir', async () => {
    const s = setup();
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    s.sync.mockRejectedValueOnce(new ApiError(503, 'X', 'indisponível'));
    await engine.act('w-1', { type: 'NOTE', text: 'a' });
    await settle(engine);
    expect(engine.getState().pending).toBe(1);
    s.sync.mockRejectedValueOnce(new ApiError(422, 'VALIDATION', 'lote inválido'));
    await engine.flush();
    await settle(engine);
    expect(engine.getState()).toMatchObject({ pending: 0, rejected: 1 });
  });

  it('login vencido (401) pára o envio sem perder nada; voltar a entrar retoma', async () => {
    const s = setup();
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    s.sync.mockRejectedValueOnce(new ApiError(401, 'UNAUTHORIZED', 'sessão'));
    await engine.act('w-1', { type: 'START' });
    await vi.waitFor(() => expect(engine.getState().authNeeded).toBe(true));
    await settle(engine);
    expect(engine.getState().pending).toBe(1);
    s.sync.mockClear();
    await engine.flush();
    expect(s.sync).not.toHaveBeenCalled();
    await engine.setUser(user);
    await engine.flush();
    await settle(engine);
    expect(s.sync).toHaveBeenCalledTimes(1);
    expect(engine.getState().pending).toBe(0);
  });

  it('atualizar do servidor mantém por cima as ações ainda não enviadas', async () => {
    const s = setup();
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    s.sync.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'sem rede'));
    await engine.act('w-1', { type: 'CHECK', itemId: 'k-2', done: true });
    await settle(engine);
    s.orders.mockResolvedValue([fieldOrder({ notes: 'versão nova do servidor' })]);
    await engine.refresh();
    const order = engine.getState().orders[0]!;
    expect(order.notes).toBe('versão nova do servidor');
    expect(order.checklist[1]!.done).toBe(true);
  });

  it('ordem que sumiu da lista do servidor sai do aparelho, salvo se ainda há algo dela a enviar', async () => {
    const s = setup();
    s.orders.mockResolvedValue([fieldOrder(), fieldOrder({ id: 'w-2' })]);
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    s.sync.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'sem rede'));
    await engine.act('w-2', { type: 'NOTE', text: 'pendente' });
    await settle(engine);
    s.orders.mockResolvedValue([]);
    await engine.refresh();
    expect(engine.getState().orders.map((o) => o.id)).toEqual(['w-2']);
  });

  it('envia em lotes de 50 ações', async () => {
    const s = setup({ online: false });
    const { engine } = await s.make();
    await engine.setUser(user);
    s.setOnline(true);
    engine.setOnline(true);
    await engine.refresh();
    s.setOnline(false);
    engine.setOnline(false);
    for (let i = 0; i < 120; i += 1) await engine.act('w-1', { type: 'NOTE', text: `n${i}` });
    s.setOnline(true);
    engine.setOnline(true);
    await vi.waitFor(() => expect(s.sync).toHaveBeenCalledTimes(3));
    await settle(engine);
    expect(s.sync.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20]);
    expect(engine.getState().pending).toBe(0);
  });

  it('fotos: vão com legenda, hora e local; saem do aparelho depois de enviadas; falha de rede mantém; 422 recusa', async () => {
    const s = setup();
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    s.uploadPhoto.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'sem rede'));
    await engine.addPhoto('w-1', new Blob(['x'], { type: 'image/jpeg' }), 'Estrutura');
    await vi.waitFor(() => expect(s.uploadPhoto).toHaveBeenCalledTimes(1));
    await settle(engine);
    expect(engine.getState().orders[0]!.pendingPhotos).toHaveLength(1);
    await engine.flush();
    await settle(engine);
    expect(engine.getState().orders[0]!.pendingPhotos).toHaveLength(0);
    const form = s.uploadPhoto.mock.calls[1]![1];
    expect(form.get('caption')).toBe('Estrutura');
    expect(form.get('latitude')).toBe('-15.79');
    expect(form.get('clientActionId')).toMatch(/^0190a1b2/);
    expect(form.get('takenAt')).toEqual(expect.any(String));
    expect(form.get('file')).toBeInstanceOf(Blob);
    // Recusada pelo servidor: fica marcada para a pessoa ver.
    s.uploadPhoto.mockRejectedValueOnce(new ApiError(422, 'X', 'Envie uma imagem'));
    await engine.addPhoto('w-1', new Blob(['y']));
    await vi.waitFor(() => expect(engine.getState().rejected).toBe(1));
    expect(engine.getState().orders[0]!.rejectedFiles[0]).toMatchObject({
      message: 'Envie uma imagem',
    });
  });

  it('assinatura: a nova substitui uma ainda não enviada e vai com o nome', async () => {
    const s = setup({ online: false });
    const { engine } = await s.make();
    await engine.setUser(user);
    s.setOnline(true);
    engine.setOnline(true);
    await engine.refresh();
    s.setOnline(false);
    engine.setOnline(false);
    await engine.saveSignature('w-1', new Blob(['a'], { type: 'image/png' }), 'Maria');
    await engine.saveSignature('w-1', new Blob(['b'], { type: 'image/png' }), 'Maria da Silva');
    expect(engine.getState().orders[0]!.pendingSignature?.signedByName).toBe('Maria da Silva');
    expect(engine.getState().pending).toBe(1);
    s.setOnline(true);
    engine.setOnline(true);
    await vi.waitFor(() => expect(s.saveSignature).toHaveBeenCalledTimes(1));
    await settle(engine);
    expect(s.saveSignature.mock.calls[0]![1].get('signedByName')).toBe('Maria da Silva');
    expect(engine.getState().pending).toBe(0);
  });

  it('perfil guardado permite abrir o app sem internet; apagar o aparelho só vale sem pendências', async () => {
    const s = setup();
    const { engine } = await s.make();
    await engine.setUser(user);
    expect(await engine.cachedProfile()).toMatchObject({ userId: 'u-1', name: 'João Instalador' });
    await engine.refresh();
    s.sync.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'sem rede'));
    await engine.act('w-1', { type: 'NOTE', text: 'x' });
    await settle(engine);
    expect(await engine.clearDevice()).toBe(false);
    s.sync.mockImplementation(async (actions) =>
      actions.map((a) => ({
        clientActionId: a.clientActionId,
        status: 'APPLIED' as const,
        message: null,
      })),
    );
    await engine.flush();
    await settle(engine);
    expect(await engine.clearDevice()).toBe(true);
    expect(await engine.cachedProfile()).toBeUndefined();
    expect(engine.getState().orders).toEqual([]);
  });

  it('cada pessoa vê só o que é dela no mesmo aparelho', async () => {
    const s = setup();
    const { engine } = await s.make();
    await engine.setUser(user);
    await engine.refresh();
    s.sync.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'sem rede'));
    await engine.act('w-1', { type: 'NOTE', text: 'do João' });
    await settle(engine);
    await engine.setUser({ id: 'u-2', name: 'Outro' });
    expect(engine.getState()).toMatchObject({ orders: [], pending: 0 });
    await engine.setUser(user);
    expect(engine.getState().pending).toBe(1);
  });
});
