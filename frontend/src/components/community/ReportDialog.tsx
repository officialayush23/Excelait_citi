import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const REASONS = ['spam', 'unsafe', 'money', 'wrong', 'other'] as const

/** Tell us about a post, answer or offer that feels wrong. Reasons are tap-to-pick. */
export function ReportDialog({
  open,
  onOpenChange,
  kind,
  targetId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: 'post' | 'comment' | 'opportunity' | 'user'
  targetId: string
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState<(typeof REASONS)[number]>('spam')
  const [note, setNote] = useState('')
  const send = useMutation({
    mutationFn: () =>
      api('/api/v1/community/reports', {
        method: 'POST',
        body: JSON.stringify({ kind, target_id: targetId, reason: `${reason}${note.trim() ? `: ${note.trim()}` : ''}` }),
      }),
    onSuccess: () => {
      toast.success(t('community.reportSent'))
      setNote('')
      onOpenChange(false)
    },
    onError: () => toast.error(t('community.tryAgain')),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>{t('community.reportTitle')}</DialogTitle>
          <DialogDescription>{t('community.reportBody')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('community.reportTitle')}>
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                'min-h-12 rounded-2xl border px-4 py-2 text-left text-base transition-colors',
                reason === r ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'bg-card hover:bg-accent/50',
              )}
            >
              {t(`community.reason.${r}`)}
            </button>
          ))}
        </div>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder={t('community.reportNote')} className="text-base" />
        <Button size="lg" className="h-12 rounded-full text-base" disabled={send.isPending} onClick={() => send.mutate()}>
          {t('community.reportSend')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
