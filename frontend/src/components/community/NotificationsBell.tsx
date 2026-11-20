import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { timeAgo } from '@/components/community/shared'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

type Note = { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

/** Bell with an unread badge. Opens a side sheet; tapping a note opens its link and marks all as read. */
export function NotificationsBell({ className }: { className?: string }) {
  const { t } = useTranslation()
  const lang = useUi((s) => s.language)
  const { session } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: Note[]; unread: number }>('/api/v1/notifications'),
    enabled: !!session,
    refetchInterval: 60_000,
    retry: false,
  })
  const markRead = useMutation({
    mutationFn: () => api('/api/v1/notifications/read', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const unread = list.data?.unread ?? 0

  function openNote(n: Note) {
    setOpen(false)
    if (unread) markRead.mutate()
    if (n.link) navigate(n.link.startsWith('/') ? n.link : '/app')
  }

  return (
    <>
      <button
        type="button"
        className={cn('relative', className)}
        aria-label={unread ? t('community.bell.unread', { count: unread }) : t('common.notifications')}
        onClick={() => setOpen(true)}
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-bold leading-5 text-white">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-sm">
          <SheetHeader className="border-b p-5">
            <SheetTitle className="text-xl">{t('common.notifications')}</SheetTitle>
            <SheetDescription>{t('community.bell.hint')}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {list.isPending ? (
              <div className="flex flex-col gap-2 p-4" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted/50" />
                ))}
              </div>
            ) : !list.data?.notifications.length ? (
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-highlight text-highlight-foreground">
                  <BellOff className="size-6" />
                </span>
                <p className="font-semibold">{t('community.bell.emptyTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('community.bell.emptyBody')}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2 p-3">
                {list.data.notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNote(n)}
                      className={cn('flex w-full flex-col gap-1 rounded-2xl border p-4 text-left transition-colors hover:bg-accent/40', n.read_at ? 'bg-card' : 'bg-tile-sky text-tile-foreground')}
                    >
                      <span className="font-semibold leading-snug">{n.title}</span>
                      {n.body && <span className="text-sm opacity-80">{n.body}</span>}
                      <span className="text-xs opacity-70">{timeAgo(n.created_at, lang)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
