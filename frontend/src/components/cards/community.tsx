import { BadgeCheck, CalendarClock, HelpCircle, Lightbulb, MessageCircle, MessagesSquare, Route, Sparkles, Star, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { to } from '@/lib/links'

import { CardShell, RowLink, SeeAll, TileIcon, useDateText, type TileTone } from './kit'
import type { CardOf } from './types'

const KIND: Record<string, { icon: typeof HelpCircle; tone: TileTone }> = {
  question: { icon: HelpCircle, tone: 'sky' },
  story: { icon: Star, tone: 'rose' },
  opportunity: { icon: Sparkles, tone: 'mint' },
  resource: { icon: Lightbulb, tone: 'peach' },
  post: { icon: MessageCircle, tone: 'lilac' },
}

export function PostsCard({ card }: { card: CardOf<'posts'> }) {
  const { t } = useTranslation()
  const date = useDateText()
  return (
    <CardShell icon={<MessagesSquare />} tone="lilac" title={t('saathi.cards.posts')} subtitle={t('saathi.cards.postsSub')}>
      {card.items.length ? (
        <ul className="flex flex-col gap-2">
          {card.items.map((p) => {
            const k = KIND[p.kind] ?? KIND.post
            const Icon = k.icon
            return (
              <li key={p.id}>
                <RowLink
                  to={to.post(p.id)}
                  leading={<TileIcon icon={<Icon />} tone={k.tone} />}
                  title={p.title}
                  subtitle={
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {p.author_name && (
                        <span className="inline-flex items-center gap-1">
                          {p.author_name}
                          {p.author_senior && <BadgeCheck aria-label={t('saathi.senior')} className="size-3.5 text-success" />}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle aria-hidden="true" className="size-3.5" />
                        {t('saathi.answers', { count: p.answer_count ?? 0 })}
                      </span>
                      {p.deadline && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock aria-hidden="true" className="size-3.5" />
                          {t('saathi.applyBy', { date: date(p.deadline) })}
                        </span>
                      )}
                    </span>
                  }
                />
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('saathi.cards.noPosts')}</p>
      )}
      <SeeAll to={to.community()}>{t('saathi.cards.allCommunity')}</SeeAll>
    </CardShell>
  )
}

function initials(name?: string | null) {
  return (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
}

export function SeniorsCard({ card }: { card: CardOf<'seniors'> }) {
  const { t } = useTranslation()
  return (
    <CardShell icon={<Users />} tone="rose" title={t('saathi.cards.seniors')} subtitle={t('saathi.cards.seniorsSub')}>
      {card.items.length ? (
        <ul className="flex flex-col gap-2">
          {card.items.slice(0, 6).map((s) => (
            <li key={s.id}>
              <RowLink
                to={to.community({ kind: 'question' })}
                className="items-start"
                leading={<span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-tile-rose text-sm font-semibold text-tile-foreground">{initials(s.full_name)}</span>}
                title={s.full_name ?? t('saathi.senior')}
                subtitle={
                  <span className="flex flex-col gap-1">
                    {s.senior_path && (
                      <span className="flex items-start gap-1 font-medium text-foreground/80">
                        <Route aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                        {s.senior_path}
                      </span>
                    )}
                    {s.bio && <span className="line-clamp-2">{s.bio}</span>}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('saathi.cards.noSeniors')}</p>
      )}
      <SeeAll to={to.community({ kind: 'question' })}>{t('saathi.cards.askSeniors')}</SeeAll>
    </CardShell>
  )
}
