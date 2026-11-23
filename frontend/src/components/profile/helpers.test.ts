import { describe, expect, it } from 'vitest'

import { sampleProfile } from './fixture'
import { buildChains, countSensitive, groupFacts, layoutGraph, nodeSlug, parseEdited, pick, shortDate } from './helpers'

describe('groupFacts', () => {
  it('hides private facts until asked and keeps group order', () => {
    const hidden = groupFacts(sampleProfile.facts, false)
    expect(hidden.map((g) => g.group)).toEqual(['basics', 'study', 'interests', 'work'])
    const all = groupFacts(sampleProfile.facts, true)
    expect(all.map((g) => g.group)).toEqual(['basics', 'study', 'interests', 'money', 'personal', 'work'])
    expect(countSensitive(sampleProfile.facts)).toBe(2)
  })
})

describe('parseEdited', () => {
  it('keeps the original type', () => {
    expect(parseEdited(['a'], 'x, y ,')).toEqual(['x', 'y'])
    expect(parseEdited(5, '72')).toBe(72)
    expect(parseEdited('Pune', ' Satara ')).toBe('Satara')
  })
})

describe('layoutGraph', () => {
  const layout = layoutGraph(sampleProfile.graph)
  it('places nodes in columns by type, left to right', () => {
    const col = (id: string) => layout.nodes.find((n) => n.id === id)!.col
    expect(col('me')).toBe(0)
    expect(col('fact:interests')).toBe(1)
    expect(col('career:electrician')).toBe(2)
    expect(col('course:iti-electrician')).toBe(3)
    expect(col('scheme:post-matric-obc')).toBe(4)
  })
  it('is deterministic and keeps every node inside the canvas', () => {
    expect(layoutGraph(sampleProfile.graph)).toEqual(layout)
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x + layout.nodeW).toBeLessThanOrEqual(layout.width)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y + layout.nodeH).toBeLessThanOrEqual(layout.height)
    }
    expect(layout.edges).toHaveLength(sampleProfile.graph.edges.length)
  })
  it('caps a crowded column and counts what it left out', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `career:c${i}`, type: 'career' as const, label: `C${i}` }))
    const l = layoutGraph({ nodes: [{ id: 'me', type: 'me', label: 'You' }, ...nodes], edges: [{ from: 'me', to: 'career:c3' }] }, { maxPerColumn: 5 })
    expect(l.nodes.filter((n) => n.type === 'career')).toHaveLength(5)
    expect(l.nodes.some((n) => n.id === 'career:c3')).toBe(true)
    expect(l.hidden).toBe(7)
  })
  it('survives an empty graph', () => {
    expect(layoutGraph({ nodes: [], edges: [] }).nodes).toEqual([])
  })
})

describe('buildChains', () => {
  it('links facts to a career and follows it on to courses and schemes', () => {
    const { chains, loose } = buildChains(sampleProfile.graph)
    const e = chains.find((c) => c.career.id === 'career:electrician')!
    expect(e.from.map((n) => n.id).sort()).toEqual(['fact:interests', 'skill:pump'])
    expect(e.onward.map((n) => n.id)).toEqual(['course:iti-electrician', 'scheme:post-matric-obc'])
    expect(loose).toEqual([])
  })
})

describe('small helpers', () => {
  it('nodeSlug strips the type prefix', () => {
    expect(nodeSlug('career:electrician')).toBe('electrician')
    expect(nodeSlug('electrician')).toBe('electrician')
  })
  it('pick falls back to English', () => {
    expect(pick({ en: 'Class', hi: 'कक्षा' }, 'mr')).toBe('Class')
    expect(pick({ en: 'Class', hi: 'कक्षा' }, 'hi')).toBe('कक्षा')
  })
  it('shortDate ignores bad input', () => {
    expect(shortDate('nope', 'en')).toBe('')
  })
})
