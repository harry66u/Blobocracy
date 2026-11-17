export * from './types';
export { MemoryStore, summarize, bucketSize } from './memory';
export { ResilientStore, type ResilientOptions } from './resilient';
import { MemoryStore } from './memory';
import type { Store } from './types';

/** Postgres when `DATABASE_URL` is set, otherwise in memory (history is lost on restart). */
export async function createStore(databaseUrl: string | undefined): Promise<Store> {
  if (!databaseUrl) return new MemoryStore();
  const { PostgresStore } = await import('./postgres');
  return new PostgresStore(databaseUrl);
}
