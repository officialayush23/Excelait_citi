import { CheckCircle2, ChevronRight, Clock, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

import { type Skill, type TaskStatus, loc } from './shared'

const TONE: Record<TaskStatus, string> = {
  todo: 'bg-secondary text-secondary-foreground',
  submitted: 'bg-tile-sky text-tile-foreground',
  resubmit: 'bg-tile-peach text-tile-foreground',
  approved: 'bg-highlight text-highlight-foreground',
  rejected: 'bg-tile-rose text-tile-foreground',
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const { t } = useTranslation()
  const Icon = status === 'approved' ? CheckCircle2 : status === 'submitted' ? Clock : status === 'resubmit' ? RotateCcw : null
  return (
    <span className={cn('inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold', TONE[status])}>
      {Icon && <Icon className="size-3.5" />}
      {t(`passport.status.${status}`)}
    </span>
  )
}

export function SkillRow({ skill }: { skill: Skill }) {
  const lang = useUi((s) => s.language)
  return (
    <li className="rounded-2xl border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold sm:text-lg">{loc(skill.name, skill.name_i18n, lang)}</h3>
        {skill.nsqf_level && <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">NSQF {skill.nsqf_level}</span>}
      </div>
      <ul className="flex flex-col gap-1">
        {skill.tasks.map((task) => (
          <li key={task.id}>
            <Link to={`/app/passport/tasks/${task.id}`} className="flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 hover:bg-accent/40">
              <span className="min-w-0 flex-1 text-sm">{loc(task.title, task.title_i18n, lang)}</span>
              <StatusChip status={task.status} />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </li>
  )
}
