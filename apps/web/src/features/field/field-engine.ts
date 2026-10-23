import type {
  FieldActionInput,
  FieldGeoInput,
  FieldSyncResultDto,
  FieldWorkOrderDto,
} from '@voltex/shared';
import { isApiError } from '@/lib/api/errors';
import type { Endpoints } from '@/lib/api/endpoints';
import { applyLocal, rebase } from './field-local';
import { blobToBytes, fileOf } from './field-db';
import type {
  FieldDb,
  FieldProfile,
  PendingPhoto,
  PendingSignature,
  QueuedAction,
  StoredOrder,
} from './field-db';

export interface FieldViewOrder extends FieldWorkOrderDto {
  /** Ações feitas no aparelho e ainda não enviadas. */
  pendingActions: number;
  /** Ações que o servidor recusou (a pessoa precisa olhar). */
  rejectedActions: QueuedAction[];
  pendingPhotos: PendingPhoto[];
  pendingSignature: PendingSignature | null;
  rejectedFiles: (PendingPhoto | PendingSignature)[];
}

export interface FieldState {
  ready: boolean;
  user: { id: string; name: string } | null;
  orders: FieldViewOrder[];
  /** Itens (ações, fotos, assinaturas) esperando envio. */
  pending: number;
  /** Itens que o servidor recusou. */
  rejected: number;
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  error: string | null;
  /** O servidor pediu login de novo: o que está no aparelho não se perde, mas só sincroniza depois de entrar. */
  authNeeded: boolean;
}

export interface FieldEngineOptions {
  db: FieldDb;
  endpoints: Pick<Endpoints, 'field'>;
  isOnline?: () => boolean;
  now?: () => Date;
  uuid?: () => string;
  /** Posição atual, se o aparelho der (nunca bloqueia a ação por mais que alguns segundos). */
  position?: () => Promise<FieldGeoInput | null>;
}

const CHUNK = 50;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** O que a tela informa; o motor completa com a chave, a ordem e a hora. */
type NewAction = DistributiveOmit<
  FieldActionInput,
  'clientActionId' | 'capturedAt' | 'workOrderId'
>;

/**
 * Motor do app de campo (ADR-0021). Tudo o que a pessoa faz vira um registro no aparelho primeiro (a tela responde na
 * hora, com ou sem internet) e é enviado em lote quando dá. O servidor é idempotente por `clientActionId`, então
 * reenviar nunca repete nada; o que ele recusa fica visível para a pessoa, e nada do que está no servidor é sobrescrito.
 */
export class FieldEngine {
  private state: FieldState = {
    ready: false,
    user: null,
    orders: [],
    pending: 0,
    rejected: 0,
    online: true,
    syncing: false,
    lastSyncAt: null,
    error: null,
    authNeeded: false,
  };
  private listeners = new Set<() => void>();
  private flushing: Promise<void> | null = null;
  private rerun = false;
  private disposed = false;
  private readonly isOnline: () => boolean;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly position: () => Promise<FieldGeoInput | null>;

  constructor(private readonly options: FieldEngineOptions) {
    this.isOnline = options.isOnline ?? (() => true);
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.position = options.position ?? (async () => null);
    this.state = { ...this.state, online: this.isOnline() };
  }

  // --- estado observável ------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): FieldState => this.state;

  private set(patch: Partial<FieldState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Encerra o motor (a tela saiu): nada mais é enviado nem atualizado, e ninguém mais é avisado. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  setOnline(online: boolean): void {
    if (online === this.state.online) return;
    this.set({ online });
    if (online) void this.flush();
  }

  // --- usuário e perfil -------------------------------------------------------------------------------------

  /** Define quem está usando o aparelho (guarda o perfil para abrir sem internet) e carrega os dados dele. */
  async setUser(
    user: { id: string; name: string } | null,
    options: { persist?: boolean } = {},
  ): Promise<void> {
    if (user && options.persist !== false) {
      const profile: FieldProfile = {
        userId: user.id,
        name: user.name,
        savedAt: this.now().toISOString(),
      };
      await this.options.db.put('meta', profile, 'profile');
    }
    this.set({ user, authNeeded: false });
    await this.reload();
  }

  /** O app foi aberto só com o perfil do aparelho (sem sessão): o que há aqui só sincroniza depois de entrar. */
  requireLogin(): void {
    this.set({ authNeeded: true, error: 'Entre de novo para enviar o que está no aparelho.' });
  }

  async cachedProfile(): Promise<FieldProfile | undefined> {
    return this.options.db.get('meta', 'profile');
  }

  // --- leitura do banco local -------------------------------------------------------------------------------

  /** Refaz o estado a partir do que está gravado no aparelho. */
  async reload(): Promise<void> {
    const { db } = this.options;
    const user = this.state.user;
    if (!user) {
      this.set({ ready: true, orders: [], pending: 0, rejected: 0 });
      return;
    }
    const [orders, queue, photos, signatures] = await Promise.all([
      db.getAllFromIndex('orders', 'by-user', user.id),
      db.getAllFromIndex('queue', 'by-user', user.id),
      db.getAllFromIndex('photos', 'by-user', user.id),
      db.getAllFromIndex('signatures', 'by-user', user.id),
    ]);
    const view: FieldViewOrder[] = orders
      .map(({ userId: _u, ...order }) => {
        void _u;
        return {
          ...order,
          pendingActions: queue.filter((q) => q.workOrderId === order.id && q.status === 'PENDING')
            .length,
          rejectedActions: queue.filter(
            (q) => q.workOrderId === order.id && q.status === 'REJECTED',
          ),
          pendingPhotos: photos.filter((p) => p.workOrderId === order.id && p.status === 'PENDING'),
          pendingSignature:
            signatures.find((s) => s.workOrderId === order.id && s.status === 'PENDING') ?? null,
          rejectedFiles: [
            ...photos.filter((p) => p.workOrderId === order.id && p.status === 'REJECTED'),
            ...signatures.filter((s) => s.workOrderId === order.id && s.status === 'REJECTED'),
          ],
        };
      })
      .sort((a, b) => (a.scheduledStart ?? '').localeCompare(b.scheduledStart ?? ''));
    const pending =
      queue.filter((q) => q.status === 'PENDING').length +
      photos.filter((p) => p.status === 'PENDING').length +
      signatures.filter((s) => s.status === 'PENDING').length;
    const rejected =
      queue.filter((q) => q.status === 'REJECTED').length +
      photos.filter((p) => p.status === 'REJECTED').length +
      signatures.filter((s) => s.status === 'REJECTED').length;
    this.set({ ready: true, orders: view, pending, rejected });
  }

  // --- atualizar do servidor --------------------------------------------------------------------------------

  /** Baixa as ordens do técnico e guarda no aparelho, com as ações pendentes aplicadas por cima. */
  async refresh(): Promise<void> {
    const user = this.state.user;
    if (this.disposed || !user || !this.state.online) return;
    let fresh: FieldWorkOrderDto[];
    try {
      fresh = await this.options.endpoints.field.orders();
    } catch (error) {
      this.handleNetworkError(error);
      return;
    }
    const { db } = this.options;
    // Leitura da fila e gravação das ordens na MESMA transação: uma ação registrada neste instante não pode ser
    // atropelada por uma cópia do servidor que ainda não a conhece.
    const tx = db.transaction(['orders', 'queue', 'photos', 'signatures'], 'readwrite');
    const [queue, photos, signatures, stored] = await Promise.all([
      tx.objectStore('queue').index('by-user').getAll(user.id),
      tx.objectStore('photos').index('by-user').getAll(user.id),
      tx.objectStore('signatures').index('by-user').getAll(user.id),
      tx.objectStore('orders').index('by-user').getAll(user.id),
    ]);
    const pendingActions = queue.filter((q) => q.status === 'PENDING');
    const orders = tx.objectStore('orders');
    const freshIds = new Set(fresh.map((o) => o.id));
    for (const order of fresh)
      await orders.put({ ...rebase(order, pendingActions), userId: user.id });
    // Ordem que saiu da lista do servidor (concluída e sincronizada, cancelada) só fica se ainda há algo dela a enviar.
    for (const old of stored) {
      if (freshIds.has(old.id)) continue;
      const hasPending =
        pendingActions.some((a) => a.workOrderId === old.id) ||
        photos.some((p) => p.workOrderId === old.id && p.status === 'PENDING') ||
        signatures.some((s) => s.workOrderId === old.id && s.status === 'PENDING');
      if (!hasPending) await orders.delete(old.id);
    }
    await tx.done;
    this.set({ lastSyncAt: this.now().toISOString(), error: null });
    await this.reload();
  }

  // --- ações do técnico -------------------------------------------------------------------------------------

  /**
   * Registra uma ação no aparelho e tenta enviar. A tela já vê o resultado antes de a gravação terminar (atualização
   * otimista em memória); a posição do GPS, nas ações que a levam (iniciar e concluir), é anexada depois e o envio
   * espera por ela, sem atrasar a tela.
   */
  async act(workOrderId: string, input: NewAction): Promise<void> {
    const user = this.state.user;
    if (!user) throw new Error('Nenhum usuário no aparelho');
    const { db } = this.options;
    const capturedAt = this.now().toISOString();
    const action = {
      ...input,
      clientActionId: this.uuid(),
      workOrderId,
      capturedAt,
    } as FieldActionInput;
    this.set({
      orders: this.state.orders.map((o) =>
        o.id === workOrderId
          ? { ...o, ...applyLocal(o, action), pendingActions: o.pendingActions + 1 }
          : o,
      ),
      pending: this.state.pending + 1,
    });
    const tx = db.transaction(['orders', 'queue'], 'readwrite');
    const stored = await tx.objectStore('orders').get(workOrderId);
    if (!stored) {
      tx.abort();
      await this.reload();
      throw new Error('Ordem não encontrada no aparelho');
    }
    const queued: QueuedAction = {
      ...action,
      userId: user.id,
      status: 'PENDING',
      message: null,
      createdAt: capturedAt,
    };
    const { userId, ...dto } = stored;
    await tx.objectStore('queue').put(queued);
    await tx.objectStore('orders').put({ ...applyLocal(dto, action), userId });
    await tx.done;
    if ((action.type === 'START' || action.type === 'COMPLETE') && !action.geo) {
      const geo = await this.position();
      if (geo) {
        const current = await db.get('queue', action.clientActionId);
        if (current?.status === 'PENDING')
          await db.put('queue', { ...current, geo } as QueuedAction);
      }
    }
    await this.reload();
    void this.flush();
  }

  async addPhoto(workOrderId: string, blob: Blob, caption: string | null = null): Promise<void> {
    const user = this.state.user;
    if (!user) throw new Error('Nenhum usuário no aparelho');
    const takenAt = this.now().toISOString();
    const geo = await this.position();
    await this.options.db.put('photos', {
      clientActionId: this.uuid(),
      userId: user.id,
      workOrderId,
      bytes: await blobToBytes(blob),
      mimeType: blob.type || 'image/jpeg',
      caption,
      takenAt,
      geo,
      status: 'PENDING',
      message: null,
      createdAt: takenAt,
    });
    await this.reload();
    void this.flush();
  }

  /** Guarda a assinatura (a nova substitui uma ainda não enviada da mesma ordem). */
  async saveSignature(workOrderId: string, blob: Blob, signedByName: string): Promise<void> {
    const user = this.state.user;
    if (!user) throw new Error('Nenhum usuário no aparelho');
    const { db } = this.options;
    const previous = (await db.getAllFromIndex('signatures', 'by-user', user.id)).filter(
      (s) => s.workOrderId === workOrderId && s.status === 'PENDING',
    );
    for (const s of previous) await db.delete('signatures', s.clientActionId);
    await db.put('signatures', {
      clientActionId: this.uuid(),
      userId: user.id,
      workOrderId,
      bytes: await blobToBytes(blob),
      mimeType: blob.type || 'image/png',
      signedByName,
      status: 'PENDING',
      message: null,
      createdAt: this.now().toISOString(),
    });
    await this.reload();
    void this.flush();
  }

  /** Tira da lista algo que o servidor recusou (a pessoa já viu). */
  async dismiss(clientActionId: string): Promise<void> {
    const { db } = this.options;
    await Promise.all([
      db.delete('queue', clientActionId),
      db.delete('photos', clientActionId),
      db.delete('signatures', clientActionId),
    ]);
    await this.reload();
  }

  /** Apaga tudo do aparelho (ao trocar de pessoa). Só vale sem nada pendente. */
  async clearDevice(): Promise<boolean> {
    if (this.state.pending > 0) return false;
    const { db } = this.options;
    for (const store of ['orders', 'queue', 'photos', 'signatures', 'meta'] as const)
      await db.clear(store);
    this.set({ orders: [], pending: 0, rejected: 0, user: null, lastSyncAt: null });
    return true;
  }

  // --- envio ------------------------------------------------------------------------------------------------

  /**
   * Envia o que está esperando. Se já há um envio em andamento, pede para repetir assim que ele terminar: uma ação
   * registrada no meio do envio não pode ficar esquecida até a próxima rodada.
   */
  flush(): Promise<void> {
    if (this.disposed || !this.state.user || !this.state.online || this.state.authNeeded)
      return Promise.resolve();
    if (this.flushing) {
      this.rerun = true;
      return this.flushing;
    }
    this.set({ syncing: true });
    this.flushing = (async () => {
      try {
        do {
          this.rerun = false;
          await this.doFlush();
        } while (this.rerun && !this.disposed && this.state.online && !this.state.authNeeded);
      } catch (error) {
        this.handleNetworkError(error);
      } finally {
        this.flushing = null;
        this.rerun = false;
        this.set({ syncing: false });
      }
    })();
    return this.flushing;
  }

  private handleNetworkError(error: unknown): void {
    if (isApiError(error) && (error.status === 401 || error.status === 403)) {
      this.set({ authNeeded: true, error: 'Entre de novo para enviar o que está no aparelho.' });
      return;
    }
    this.set({
      error:
        isApiError(error) && error.status === 0
          ? 'Sem conexão com o sistema.'
          : 'Não foi possível sincronizar agora.',
    });
  }

  private async doFlush(): Promise<void> {
    const user = this.state.user!;
    const { db, endpoints } = this.options;

    // 1) Ações, em ordem, em lotes.
    const queue = (await db.getAllFromIndex('queue', 'by-user', user.id))
      .filter((q) => q.status === 'PENDING')
      .sort(
        (a, b) =>
          a.capturedAt.localeCompare(b.capturedAt) || a.createdAt.localeCompare(b.createdAt),
      );
    for (let i = 0; i < queue.length && !this.disposed; i += CHUNK) {
      const chunk = queue.slice(i, i + CHUNK);
      let results: FieldSyncResultDto[];
      try {
        results = await endpoints.field.sync(chunk.map(toAction));
      } catch (error) {
        if (
          isApiError(error) &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 401 &&
          error.status !== 403 &&
          error.status !== 429
        ) {
          // O servidor não aceita o formato do lote: recusa tudo e mostra, em vez de insistir para sempre.
          for (const q of chunk)
            await db.put('queue', { ...q, status: 'REJECTED', message: error.message });
          continue;
        }
        throw error;
      }
      for (const result of results) {
        const q = chunk.find((c) => c.clientActionId === result.clientActionId);
        if (!q) continue;
        if (result.status === 'REJECTED')
          await db.put('queue', { ...q, status: 'REJECTED', message: result.message });
        else await db.delete('queue', q.clientActionId);
      }
    }

    // 2) Fotos e 3) assinaturas.
    for (const photo of (await db.getAllFromIndex('photos', 'by-user', user.id)).filter(
      (p) => p.status === 'PENDING',
    )) {
      const form = new FormData();
      form.set('file', fileOf(photo), 'foto.jpg');
      form.set('clientActionId', photo.clientActionId);
      form.set('takenAt', photo.takenAt);
      if (photo.caption) form.set('caption', photo.caption);
      if (photo.geo) {
        form.set('latitude', String(photo.geo.latitude));
        form.set('longitude', String(photo.geo.longitude));
        if (photo.geo.accuracy !== undefined) form.set('accuracy', String(photo.geo.accuracy));
      }
      await this.sendFile('photos', photo, () =>
        endpoints.field.uploadPhoto(photo.workOrderId, form),
      );
    }
    for (const sig of (await db.getAllFromIndex('signatures', 'by-user', user.id)).filter(
      (s) => s.status === 'PENDING',
    )) {
      const form = new FormData();
      form.set('file', fileOf(sig), 'assinatura.png');
      form.set('clientActionId', sig.clientActionId);
      form.set('signedByName', sig.signedByName);
      await this.sendFile('signatures', sig, () =>
        endpoints.field.saveSignature(sig.workOrderId, form),
      );
    }

    await this.reload();
    await this.refresh();
  }

  private async sendFile(
    store: 'photos' | 'signatures',
    item: PendingPhoto | PendingSignature,
    send: () => Promise<unknown>,
  ): Promise<void> {
    const { db } = this.options;
    try {
      await send();
      await db.delete(store, item.clientActionId);
    } catch (error) {
      if (
        isApiError(error) &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 401 &&
        error.status !== 403 &&
        error.status !== 429
      ) {
        await db.put(store, { ...item, status: 'REJECTED', message: error.message } as never);
        return;
      }
      throw error;
    }
  }
}

const toAction = ({
  userId: _u,
  status: _s,
  message: _m,
  createdAt: _c,
  ...action
}: QueuedAction): FieldActionInput => {
  void [_u, _s, _m, _c];
  return action as FieldActionInput;
};

export type { StoredOrder };
