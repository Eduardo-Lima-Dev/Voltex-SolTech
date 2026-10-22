import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FieldActionInput, FieldGeoInput, FieldWorkOrderDto } from '@voltex/shared';

/** Perfil guardado no aparelho para abrir o app sem internet (sem token: entrar de novo é preciso para sincronizar). */
export interface FieldProfile {
  userId: string;
  name: string;
  savedAt: string;
}

export type QueuedAction = FieldActionInput & {
  userId: string;
  status: 'PENDING' | 'REJECTED';
  message: string | null;
  createdAt: string;
};

/**
 * Arquivo esperando envio. Guarda os bytes (e não o `Blob`): alguns navegadores móveis perdem `Blob` no IndexedDB,
 * e os bytes sobrevivem em todos.
 */
interface PendingFile {
  clientActionId: string;
  userId: string;
  workOrderId: string;
  bytes: ArrayBuffer;
  mimeType: string;
  status: 'PENDING' | 'REJECTED';
  message: string | null;
  createdAt: string;
}

export interface PendingPhoto extends PendingFile {
  caption: string | null;
  takenAt: string;
  geo: FieldGeoInput | null;
}

export interface PendingSignature extends PendingFile {
  signedByName: string;
}

export type StoredOrder = FieldWorkOrderDto & { userId: string };

interface FieldSchema extends DBSchema {
  orders: { key: string; value: StoredOrder; indexes: { 'by-user': string } };
  queue: { key: string; value: QueuedAction; indexes: { 'by-user': string } };
  photos: { key: string; value: PendingPhoto; indexes: { 'by-user': string } };
  signatures: { key: string; value: PendingSignature; indexes: { 'by-user': string } };
  meta: { key: string; value: FieldProfile };
}

export type FieldDb = IDBPDatabase<FieldSchema>;

export const FIELD_DB_NAME = 'voltex-field';

/** Banco local do app de campo (IndexedDB): ordens, fila de ações, fotos e assinaturas ainda não enviadas. */
export function openFieldDb(name = FIELD_DB_NAME): Promise<FieldDb> {
  return openDB<FieldSchema>(name, 1, {
    upgrade(db) {
      db.createObjectStore('orders', { keyPath: 'id' }).createIndex('by-user', 'userId');
      db.createObjectStore('queue', { keyPath: 'clientActionId' }).createIndex('by-user', 'userId');
      db.createObjectStore('photos', { keyPath: 'clientActionId' }).createIndex(
        'by-user',
        'userId',
      );
      db.createObjectStore('signatures', { keyPath: 'clientActionId' }).createIndex(
        'by-user',
        'userId',
      );
      db.createObjectStore('meta');
    },
  });
}

/** Lê os bytes de um arquivo (com alternativa para ambientes sem `Blob.arrayBuffer`). */
export function blobToBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Reconstrói o arquivo guardado para enviar ou mostrar. */
export const fileOf = (item: { bytes: ArrayBuffer; mimeType: string }): Blob =>
  new Blob([item.bytes], { type: item.mimeType });
