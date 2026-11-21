import { useTranslation } from 'react-i18next'

import { SpeakButton } from '@/components/shell/SpeakButton'

import type { KeyTerm, Section } from './api'

export function ReadTab({ summary, sections, terms }: { summary: string | null; sections: Section[]; terms: KeyTerm[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5">
      {summary && <p className="rounded-3xl bg-highlight p-5 text-lg leading-relaxed text-highlight-foreground">{summary}</p>}
      {sections.map((s, i) => (
        <article key={i} className="flex flex-col gap-2">
          <h3 className="text-xl font-semibold tracking-tight">{s.heading}</h3>
          <p className="text-lg leading-relaxed">{s.text}</p>
        </article>
      ))}
      {terms.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xl font-semibold tracking-tight">{t('learn.keyTerms')}</h3>
          <dl className="grid gap-2 sm:grid-cols-2">
            {terms.map((k) => (
              <div key={k.term} className="rounded-2xl border bg-card p-4">
                <dt className="flex items-center gap-1 text-lg font-semibold">
                  {k.term}
                  <SpeakButton text={`${k.term}. ${k.meaning}`} />
                </dt>
                <dd className="text-muted-foreground">{k.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}
