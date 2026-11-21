/**
 * The student's facts, local-first: every change is saved on the phone immediately and
 * queued in the outbox; the queue drains to the server whenever a signal is available.
 */
import { useEffect } from 'react'
import { create } from 'zustand'

import { api } from '@/lib/api'
import { db, getKv, setKv, type Facts } from '@/data/db'

type FactsState = {
  loaded: boolean
  facts: Facts
  pending: number
  load: (userId: string) => Promise<void>
  update: (patch: Facts, opts?: { replaceLists?: boolean }) => Promise<void>
  sync: () => Promise<void>
}

const LIST = new Set(['interests', 'subjects', 'skills'])
let syncing: Promise<void> | null = null
let again = false
let currentUser = ''
const key = () => `facts:${currentUser}`

export const useFacts = create<FactsState>((set, get) => ({
  loaded: false,
  facts: {},
  pending: 0,
  async load(userId) {
    currentUser = userId
    const local = (await getKv<Facts>(key())) ?? {}
    set({ facts: local, loaded: true, pending: await db.outbox.count() })
    // Pull the server copy when online; local unsynced changes win.
    try {
      const { facts: remote } = await api<{ facts: Facts }>('/api/v1/students/me/facts')
      // The server is the truth unless this phone holds changes it has not sent yet.
      const merged = get().pending ? { ...remote, ...get().facts } : remote
      set({ facts: merged })
      await setKv(key(), merged)
    } catch {
      /* offline: keep local */
    }
    void get().sync()
  },
  async update(patch, opts) {
    const next: Facts = { ...get().facts }
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete next[k]
      else if (LIST.has(k) && !opts?.replaceLists) next[k] = [...new Set([...((next[k] as string[]) ?? []), ...(v as string[])])]
      else next[k] = v
    }
    set({ facts: next })
    await setKv(key(), next)
    await db.outbox.add({ op_id: crypto.randomUUID(), kind: 'facts', payload: patch, replace_lists: Boolean(opts?.replaceLists), created_at: Date.now(), tries: 0 })
    set({ pending: await db.outbox.count() })
    void get().sync()
  },
  /** Sends queued changes in order, one at a time; a call during a run schedules one more run. */
  sync() {
    if (syncing) {
      again = true
      return syncing
    }
    syncing = (async () => {
      do {
        again = false
        if (!navigator.onLine) break
        const ops = await db.outbox.orderBy('created_at').toArray()
        for (const op of ops) {
          try {
            await api('/api/v1/students/me/facts', {
              method: 'PATCH',
              body: JSON.stringify({ facts: op.payload, replace_lists: op.replace_lists ?? false }),
            })
            await db.outbox.delete(op.op_id)
          } catch {
            await db.outbox.update(op.op_id, { tries: op.tries + 1 })
            again = false
            break
          }
        }
      } while (again)
      set({ pending: await db.outbox.count() })
    })().finally(() => {
      syncing = null
    })
    return syncing
  },
}))

/** Drain the outbox when the phone comes back online. */
export function useOnlineSync() {
  const sync = useFacts((s) => s.sync)
  useEffect(() => {
    const on = () => void sync()
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [sync])
}
