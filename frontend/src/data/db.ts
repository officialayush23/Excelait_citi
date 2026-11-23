import Dexie, { type Table } from 'dexie'

export type Facts = Record<string, unknown>

/** A write waiting for the network. op_id makes the server apply it once even if sent twice. */
/** Where an answer was given, kept with each fact on the server (onboarding screens, the interest quiz, a Saathi card). */
export type FactSource = 'onboarding' | 'quiz' | 'saathi'
export type OutboxOp = { op_id: string; kind: 'facts'; payload: Facts; replace_lists?: boolean; source?: FactSource; created_at: number; tries: number }

class LocalDb extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>
  outbox!: Table<OutboxOp, string>

  constructor() {
    super('excelait')
    this.version(1).stores({ kv: 'key', outbox: 'op_id, created_at' })
  }
}

export const db = new LocalDb()

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

export async function setKv(key: string, value: unknown) {
  await db.kv.put({ key, value })
}
