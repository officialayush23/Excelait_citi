import type { FactGroup, GraphEdge, GraphNode, GraphNodeType, I18nText, ProfileFact, RiasecCode } from './types'

export const GROUP_ORDER: FactGroup[] = ['basics', 'study', 'interests', 'skills', 'money', 'personal', 'work']
export const RIASEC: RiasecCode[] = ['R', 'I', 'A', 'S', 'E', 'C']

/** Picks the text in the student's language, falling back to English. */
export function pick(text: I18nText | undefined, lang: string): string {
  if (!text) return ''
  return (text as Record<string, string | undefined>)[lang] || text.en || ''
}

/** Groups facts in display order; empty groups are dropped, sensitive facts are dropped unless asked for. */
export function groupFacts(facts: ProfileFact[], showSensitive: boolean) {
  const out: { group: FactGroup; facts: ProfileFact[] }[] = []
  for (const group of GROUP_ORDER) {
    const list = facts.filter((f) => f.group === group && (showSensitive || !f.sensitive))
    if (list.length) out.push({ group, facts: list })
  }
  return out
}

/** Facts the student has not opened yet because they are private. */
export const countSensitive = (facts: ProfileFact[]) => facts.filter((f) => f.sensitive).length

/** Turns what a person types into the stored value: lists split on commas, numbers stay numbers. */
export function parseEdited(original: unknown, raw: string): unknown {
  const text = raw.trim()
  if (Array.isArray(original)) return text.split(/[,،]/).map((s) => s.trim()).filter(Boolean)
  if (typeof original === 'number') return Number(text)
  if (typeof original === 'boolean') return text === 'true'
  return text
}

export const editedIsValid = (original: unknown, raw: string) =>
  raw.trim() !== '' && (typeof original !== 'number' || Number.isFinite(Number(raw)))

export const editableText = (value: unknown) => (Array.isArray(value) ? value.join(', ') : String(value ?? ''))

export function shortNote(note: string, max = 140) {
  return note.length > max ? `${note.slice(0, max - 1).trimEnd()}…` : note
}

/** "21 Nov" in the student's language. */
export function shortDate(iso: string, lang: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'mr' ? 'mr-IN' : 'en-IN'
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/** The part of a node id after "career:" etc. (ids without a prefix are used as they are). */
export const nodeSlug = (id: string) => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : id)

// ---------------------------------------------------------------- graph layout

export const COLUMN_OF: Record<GraphNodeType, number> = { me: 0, fact: 1, interest: 1, skill: 1, career: 2, course: 3, scheme: 4 }
export type Placed = GraphNode & { x: number; y: number; col: number }
export type Layout = { width: number; height: number; nodeW: number; nodeH: number; nodes: Placed[]; edges: (GraphEdge & { x1: number; y1: number; x2: number; y2: number })[]; hidden: number }

/**
 * Left-to-right columns: me, what you told us, careers, courses, schemes. Deterministic:
 * the same graph always lands in the same place. Each column shows at most `maxPerColumn`
 * nodes, keeping the best connected ones; the rest are counted in `hidden`.
 */
export function layoutGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, opts: { width?: number; maxPerColumn?: number; rowH?: number; nodeH?: number } = {}): Layout {
  const width = opts.width ?? 1000
  const maxPer = opts.maxPerColumn ?? 8
  const rowH = opts.rowH ?? 56
  const nodeH = opts.nodeH ?? 40
  const pad = 12
  const cols = 5
  const colGap = (width - pad * 2) / cols
  const nodeW = Math.min(170, colGap - 26)

  const degree = new Map<string, number>()
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  const byCol: GraphNode[][] = Array.from({ length: cols }, () => [])
  const seen = new Set<string>()
  for (const n of graph.nodes) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    byCol[COLUMN_OF[n.type] ?? 1].push(n)
  }
  let hidden = 0
  const kept = byCol.map((list) => {
    if (list.length <= maxPer) return list
    const top = [...list].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id)).slice(0, maxPer)
    hidden += list.length - top.length
    const keepIds = new Set(top.map((n) => n.id))
    return list.filter((n) => keepIds.has(n.id))
  })
  const rows = Math.max(1, ...kept.map((l) => l.length))
  const height = rows * rowH + 16
  const placed: Placed[] = []
  kept.forEach((list, col) => {
    const colH = list.length * rowH
    const top = (height - colH) / 2
    list.forEach((n, i) => placed.push({ ...n, col, x: pad + col * colGap + (colGap - nodeW) / 2, y: top + i * rowH + (rowH - nodeH) / 2 }))
  })
  const at = new Map(placed.map((p) => [p.id, p]))
  const edges = graph.edges
    .map((e) => {
      const a = at.get(e.from)
      const b = at.get(e.to)
      if (!a || !b || a.col === b.col) return null
      const [l, r] = a.col < b.col ? [a, b] : [b, a]
      return { ...e, x1: l.x + nodeW, y1: l.y + nodeH / 2, x2: r.x, y2: r.y + nodeH / 2 }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
  return { width, height, nodeW, nodeH, nodes: placed, edges, hidden }
}

/** Smooth S-curve between two points, for an edge path. */
export const curve = (e: { x1: number; y1: number; x2: number; y2: number }) => {
  const mx = (e.x1 + e.x2) / 2
  return `M${e.x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${e.x2},${e.y2}`
}

// ------------------------------------------------------- phone-friendly chains

export type Chain = { career: GraphNode; from: GraphNode[]; onward: GraphNode[] }

/**
 * One chain per career: what you told us that points to it, then the courses and schemes
 * that follow from it. Also returns the nodes that connect to no career, so nothing is lost.
 */
export function buildChains(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): { chains: Chain[]; loose: GraphNode[] } {
  const node = new Map(graph.nodes.map((n) => [n.id, n]))
  const out = new Map<string, string[]>()
  const into = new Map<string, string[]>()
  for (const e of graph.edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e.to])
    into.set(e.to, [...(into.get(e.to) ?? []), e.from])
  }
  const used = new Set<string>()
  const chains: Chain[] = graph.nodes
    .filter((n) => n.type === 'career')
    .map((career) => {
      const from = (into.get(career.id) ?? []).map((id) => node.get(id)).filter((n): n is GraphNode => !!n && n.type !== 'me' && n.type !== 'career')
      const onward: GraphNode[] = []
      const queue = [...(out.get(career.id) ?? [])]
      const done = new Set<string>([career.id])
      while (queue.length) {
        const id = queue.shift()!
        if (done.has(id)) continue
        done.add(id)
        const n = node.get(id)
        if (n && (n.type === 'course' || n.type === 'scheme')) {
          onward.push(n)
          queue.push(...(out.get(id) ?? []))
        }
      }
      used.add(career.id)
      from.forEach((n) => used.add(n.id))
      onward.forEach((n) => used.add(n.id))
      return { career, from, onward }
    })
  const loose = graph.nodes.filter((n) => n.type !== 'me' && !used.has(n.id))
  return { chains, loose }
}

