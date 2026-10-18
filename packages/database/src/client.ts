import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export interface CreatePrismaClientOptions {
  /** Padrão: variável de ambiente `DATABASE_URL`. */
  connectionString?: string;
  log?: ('query' | 'info' | 'warn' | 'error')[];
}

/** Cria um PrismaClient com o driver adapter do PostgreSQL (`pg`), exigido pelo Prisma 7. */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL não definida: informe a variável de ambiente ou connectionString',
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    ...(options.log ? { log: options.log } : {}),
  });
}
