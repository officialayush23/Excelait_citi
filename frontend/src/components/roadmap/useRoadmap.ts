import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { ApiError, api } from '@/lib/api'

import { sampleRoadmap } from './fixture'
import type { Roadmap } from './types'

export const ROADMAP_KEY = ['roadmap']
const BASE = '/api/v1/roadmap'

export type RoadmapResult = { data: Roadmap; mock: boolean }

async function load(): Promise<RoadmapResult> {
  try {
    return { data: await api<Roadmap>(BASE), mock: false }
  } catch (e) {
    // While the endpoint is not running, develop against the sample so the page can be seen.
    const missing = e instanceof ApiError ? e.status === 404 : true
    if (import.meta.env.DEV && missing) return { data: sampleRoadmap, mock: true }
    throw e
  }
}

export function useRoadmap() {
  return useQuery({ queryKey: ROADMAP_KEY, queryFn: load, retry: false, staleTime: 30_000 })
}

/** Every roadmap action returns the new roadmap; the sample is edited in place so the page stays usable. */
export function useRoadmapAction<V>(fn: (v: V) => Promise<Roadmap | void>, errorText: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: V) => {
      const cur = qc.getQueryData<RoadmapResult>(ROADMAP_KEY)
      if (cur?.mock) return cur.data
      return fn(v)
    },
    onSuccess: (data) => {
      if (data && 'goals' in data) qc.setQueryData<RoadmapResult>(ROADMAP_KEY, (r) => ({ data, mock: r?.mock ?? false }))
      else void qc.invalidateQueries({ queryKey: ROADMAP_KEY })
      void qc.invalidateQueries({ queryKey: ['saved'] })
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : errorText),
  })
}

export const roadmapApi = {
  step: (id: string, body: Record<string, unknown>) => api<Roadmap>(`${BASE}/steps/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  undo: (id: string) => api<Roadmap>(`${BASE}/changes/${id}/undo`, { method: 'POST' }),
  easier: () => api<Roadmap>(`${BASE}/easier`, { method: 'POST' }),
  unwatch: (id: string) => api<void>(`${BASE}/watches/${id}`, { method: 'DELETE' }),
  event: (kind: string, ref?: string) => api(`${BASE}/events`, { method: 'POST', body: JSON.stringify({ kind, ref }) }).catch(() => undefined),
}

export function daysLeft(due?: string | null, today = new Date()): number | null {
  if (!due) return null
  const d = new Date(`${due.slice(0, 10)}T00:00:00`)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((d.getTime() - t.getTime()) / 86_400_000)
}
