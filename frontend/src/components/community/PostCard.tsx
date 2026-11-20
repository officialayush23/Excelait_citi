import { CircleCheck, MessageCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AuthorLine, DeadlineChip, KIND_ICON, KIND_TONE, TagChips, timeAgo, type Post } from '@/components/community/shared'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

export function PostCard({ post, answered }: { post: Post; answered?: boolean }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const navigate = useNavigate()
  const Icon = KIND_ICON[post.kind] ?? KIND_ICON.post
  const open = () => navigate(to.post(post.id))

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter') open()
      }}
      className="flex cursor-pointer gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:outline-2"
    >
      <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl text-tile-foreground', KIND_TONE[post.kind])} aria-label={t(`community.kind.${post.kind}`)}>
        <Icon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-base font-semibold leading-snug sm:text-lg">{post.title}</h3>
        {post.body && <p className="line-clamp-2 text-sm text-muted-foreground">{post.body}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {post.kind === 'opportunity' && post.deadline && <DeadlineChip deadline={post.deadline} />}
          {(post.kind === 'question' || post.answer_count > 0) && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <MessageCircle className="size-4" />
              {t('community.answerCount', { count: post.answer_count })}
            </span>
          )}
          {answered && (
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-tile-mint px-3 text-xs font-semibold text-tile-foreground">
              <CircleCheck className="size-3.5" />
              {t('community.answered')}
            </span>
          )}
        </div>
        <TagChips tags={post.tags} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <AuthorLine name={post.author_name} senior={post.author_senior} path={post.author_path} />
          <span className="text-xs text-muted-foreground">{timeAgo(post.created_at, lang)}</span>
        </div>
      </div>
    </article>
  )
}
