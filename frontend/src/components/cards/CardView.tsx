import { CareerCard, CareersCard, ExamCard, ProgramCard } from './career'
import { PostsCard, SeniorsCard } from './community'
import { SchemeCard, SchemesCard } from './money'
import { CollegesCard, OffersCard, ResourcesCard, WebCard } from './places'
import { MyPlanCard, PlanCard } from './plan'
import { QuestionCard } from './QuestionCard'
import type { Card } from './types'
import { JobsCard, LawCard } from './work'

/** Picks the right renderer for any card Saathi sends. Unknown types render nothing. */
export function CardView({ card, active }: { card: Card; active?: boolean }) {
  switch (card.type) {
    case 'careers':
      return <CareersCard card={card} />
    case 'career':
      return <CareerCard card={card} />
    case 'program':
      return <ProgramCard card={card} />
    case 'exam':
      return <ExamCard card={card} />
    case 'schemes':
      return <SchemesCard card={card} />
    case 'scheme':
      return <SchemeCard card={card} />
    case 'colleges':
      return <CollegesCard card={card} />
    case 'resources':
      return <ResourcesCard card={card} />
    case 'offers':
      return <OffersCard card={card} />
    case 'posts':
      return <PostsCard card={card} />
    case 'seniors':
      return <SeniorsCard card={card} />
    case 'my_plan':
      return <MyPlanCard card={card} />
    case 'plan':
      return <PlanCard card={card} />
    case 'web':
      return <WebCard card={card} />
    case 'question':
      return <QuestionCard card={card} active={active} />
    case 'law':
      return <LawCard card={card} />
    case 'jobs':
      return <JobsCard card={card} />
    default:
      return null
  }
}

/** A stack of cards, e.g. everything one Saathi reply brought back. */
export function CardList({ cards, active }: { cards: Card[]; active?: boolean }) {
  if (!cards.length) return null
  return (
    <div className="flex flex-col gap-3">
      {cards.map((c, i) => (
        <CardView key={`${c.type}-${i}`} card={c} active={active} />
      ))}
    </div>
  )
}
