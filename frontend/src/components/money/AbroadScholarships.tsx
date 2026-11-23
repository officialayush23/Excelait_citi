import { ExternalLink, Globe2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import abroadDoc from '@shared/rules/abroad_scholarships.json'
import { useFacts } from '@/data/facts'

type Lang = 'en' | 'hi' | 'mr'
type Item = {
  slug: string
  name: string
  provider: string
  country: string
  for: Record<Lang, string>
  categories?: string[]
  apply_url: string
  source_url: string
}

const items = abroadDoc.items as Item[]

/**
 * Scholarships to study abroad after a first degree. Shown when the student said they'd go abroad,
 * or is old enough to be planning it. Every link is to the official page.
 */
export function AbroadScholarships() {
  const { t, i18n } = useTranslation()
  const facts = useFacts((s) => s.facts)
  const lang = (['en', 'hi', 'mr'].includes(i18n.language) ? i18n.language : 'en') as Lang
  const classLevel = Number(facts.class_level ?? 0)
  const wantsAbroad = facts.go_where === 'abroad'
  if (!wantsAbroad && classLevel < 12) return null
  const category = String(facts.social_category ?? '').toLowerCase()

  return (
    <section className="mt-6 flex flex-col gap-4 rounded-[1.75rem] bg-card p-5 ring-1 ring-black/[0.04] sm:p-6 dark:ring-white/[0.05]">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tile-sky text-tile-foreground">
          <Globe2 className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t('abroad.title')}</h2>
          <p className="text-sm text-muted-foreground">{wantsAbroad ? t('abroad.leadChosen') : t('abroad.lead')}</p>
        </div>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((it) => {
          const notYours = Boolean(it.categories && category && !it.categories.includes(category))
          return (
            <li key={it.slug} className="flex min-w-0 flex-col gap-2 rounded-3xl bg-muted/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-medium ring-1 ring-border">{it.country}</span>
                {it.categories && (
                  <span className="rounded-full bg-background px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                    {t('abroad.categoryOnly')}
                  </span>
                )}
              </div>
              <h3 className={notYours ? 'font-semibold leading-snug text-muted-foreground' : 'font-semibold leading-snug'}>{it.name}</h3>
              <p className="text-xs text-muted-foreground">{it.provider}</p>
              <p className="text-sm">{it.for[lang]}</p>
              <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
                <a
                  href={it.apply_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t('abroad.official')}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
                {it.source_url !== it.apply_url && (
                  <a href={it.source_url} target="_blank" rel="noreferrer" className="text-muted-foreground underline-offset-2 hover:underline">
                    {t('abroad.source')}
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('abroad.note', { date: abroadDoc.checked_on })}</p>
    </section>
  )
}
