import { ArrowDown, Network } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { to } from '@/lib/links'
import { cn } from '@/lib/utils'

import { buildChains, curve, layoutGraph, nodeSlug } from './helpers'
import { Section } from './Parts'
import type { GraphNode, GraphNodeType, ProfileData } from './types'

/** Where a node leads; null for things that are only information. */
function nodeHref(n: GraphNode): string | null {
  const slug = nodeSlug(n.id)
  switch (n.type) {
    case 'career': return to.career(slug)
    case 'course': return to.course(slug)
    case 'scheme': return to.scheme(slug)
    case 'me': return '#facts'
    default: return null
  }
}

const FILL: Record<GraphNodeType, string> = {
  me: 'fill-primary',
  fact: 'fill-tile-sky',
  interest: 'fill-tile-lilac',
  skill: 'fill-tile-rose',
  career: 'fill-tile-peach',
  course: 'fill-tile-mint',
  scheme: 'fill-highlight',
}
const CHIP: Record<GraphNodeType, string> = {
  me: 'bg-primary text-primary-foreground',
  fact: 'bg-tile-sky text-tile-foreground',
  interest: 'bg-tile-lilac text-tile-foreground',
  skill: 'bg-tile-rose text-tile-foreground',
  career: 'bg-tile-peach text-tile-foreground',
  course: 'bg-tile-mint text-tile-foreground',
  scheme: 'bg-highlight text-highlight-foreground',
}
const TEXT: Record<GraphNodeType, string> = {
  me: 'fill-primary-foreground',
  scheme: 'fill-highlight-foreground',
  fact: 'fill-tile-foreground', interest: 'fill-tile-foreground', skill: 'fill-tile-foreground', career: 'fill-tile-foreground', course: 'fill-tile-foreground',
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function SvgMap({ graph }: { graph: ProfileData['graph'] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const layout = useMemo(() => layoutGraph(graph), [graph])
  const headers: [number, string][] = [[0, 'me'], [1, 'told'], [2, 'careers'], [3, 'courses'], [4, 'money']]
  return (
    <div className="hidden overflow-x-auto md:block">
      <svg viewBox={`0 -26 ${layout.width} ${layout.height + 26}`} className="h-auto w-full min-w-[720px]" role="group" aria-label={t('profile.mapTitle')}>
        {headers.map(([c, k]) => (
          <text key={k} x={12 + c * ((layout.width - 24) / 5) + (layout.width - 24) / 10} y={-8} textAnchor="middle" className="fill-muted-foreground text-[11px] font-medium">
            {t(`profile.mapCol.${k}`)}
          </text>
        ))}
        {layout.edges.map((e, i) => (
          <path key={i} d={curve(e)} fill="none" className="stroke-muted-foreground/35" strokeWidth="1.5">
            {e.label && <title>{e.label}</title>}
          </path>
        ))}
        {layout.nodes.map((n) => {
          const href = nodeHref(n)
          const go = () => (href?.startsWith('#') ? document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' }) : href && navigate(href))
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              role={href ? 'link' : undefined}
              tabIndex={href ? 0 : undefined}
              aria-label={n.label}
              onClick={href ? go : undefined}
              onKeyDown={href ? (e) => (e.key === 'Enter' || e.key === ' ') && go() : undefined}
              className={cn('outline-none', href && 'cursor-pointer focus-visible:[&>rect]:stroke-ring focus-visible:[&>rect]:stroke-2 hover:opacity-80')}
            >
              <rect width={layout.nodeW} height={layout.nodeH} rx={layout.nodeH / 2} className={cn(FILL[n.type], 'stroke-border')} />
              <text x={layout.nodeW / 2} y={layout.nodeH / 2 + 4.5} textAnchor="middle" className={cn('text-[13px] font-medium', TEXT[n.type])}>
                {clip(n.label, 20)}
              </text>
              <title>{n.label}</title>
            </g>
          )
        })}
      </svg>
      {layout.hidden > 0 && <p className="mt-2 text-sm text-muted-foreground">{t('profile.mapMore', { count: layout.hidden })}</p>}
    </div>
  )
}

function Pill({ n }: { n: GraphNode }) {
  const href = nodeHref(n)
  const cls = cn('inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium', CHIP[n.type])
  if (!href || href.startsWith('#')) return <span className={cls}>{n.label}</span>
  return <Link to={href} className={cn(cls, 'hover:opacity-80')}>{n.label}</Link>
}

/** Phone view: one small chain per career, read top to bottom. */
function ChainList({ graph }: { graph: ProfileData['graph'] }) {
  const { t } = useTranslation()
  const { chains, loose } = useMemo(() => buildChains(graph), [graph])
  return (
    <div className="flex flex-col gap-4 md:hidden">
      {chains.map((c) => (
        <div key={c.career.id} className="rounded-2xl border bg-surface p-3">
          {c.from.length > 0 && (
            <>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('profile.chainBecause')}</p>
              <div className="flex flex-wrap gap-2">{c.from.map((n) => <Pill key={n.id} n={n} />)}</div>
              <ArrowDown className="my-2 size-5 text-muted-foreground" aria-hidden="true" />
            </>
          )}
          <Pill n={c.career} />
          {c.onward.length > 0 && (
            <>
              <ArrowDown className="my-2 size-5 text-muted-foreground" aria-hidden="true" />
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('profile.chainNext')}</p>
              <div className="flex flex-wrap gap-2">{c.onward.map((n) => <Pill key={n.id} n={n} />)}</div>
            </>
          )}
        </div>
      ))}
      {loose.length > 0 && (
        <div className="rounded-2xl border bg-surface p-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('profile.chainLoose')}</p>
          <div className="flex flex-wrap gap-2">{loose.map((n) => <Pill key={n.id} n={n} />)}</div>
        </div>
      )}
    </div>
  )
}

/** The student's knowledge graph: what they told us, and where it leads. */
export function KnowledgeMap({ graph }: { graph: ProfileData['graph'] }) {
  const { t } = useTranslation()
  const empty = graph.nodes.filter((n) => n.type !== 'me').length === 0
  return (
    <Section icon={<Network />} title={t('profile.mapTitle')} hint={t('profile.mapHint')}>
      {empty ? (
        <p className="text-muted-foreground">{t('profile.mapEmpty')}</p>
      ) : (
        <>
          <SvgMap graph={graph} />
          <ChainList graph={graph} />
        </>
      )}
    </Section>
  )
}
