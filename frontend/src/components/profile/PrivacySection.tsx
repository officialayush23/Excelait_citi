import { Download, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { ConfirmDialog } from './ConfirmDialog'
import { Section } from './Parts'
import type { ProfileData } from './types'

/** Download a copy of everything, or clear what Saathi learned (the account stays). */
export function PrivacySection({ data, onDeleteAll }: { data: ProfileData; onDeleteAll: (keys: string[]) => Promise<{ failed: number }> }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)

  function download() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'my-excelait-data.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Section icon={<ShieldCheck />} title={t('profile.privacyTitle')} hint={t('profile.privacyHint')}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" variant="outline" size="lg" className="h-12 rounded-full px-6" onClick={download}>
          <Download data-icon="inline-start" />
          {t('profile.download')}
        </Button>
        <Button type="button" variant="outline" size="lg" className="h-12 rounded-full px-6 text-destructive" disabled={data.facts.length === 0} onClick={() => setConfirm(true)}>
          <Trash2 data-icon="inline-start" />
          {t('profile.deleteAll')}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{t('profile.deleteAllNote')}</p>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('profile.deleteAllTitle')}
        body={t('profile.deleteAllBody', { count: data.facts.length })}
        confirmLabel={t('profile.deleteAll')}
        onConfirm={async () => {
          const { failed } = await onDeleteAll(data.facts.map((f) => f.key))
          if (failed) toast.error(t('profile.deleteSomeFailed', { count: failed }))
          else toast.success(t('profile.deletedAll'))
        }}
      />
    </Section>
  )
}
