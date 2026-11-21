import { useTranslation } from 'react-i18next'

import { ListSkeleton, Note, Section } from '@/components/explore/shared'
import { useLessons } from '@/components/learn/api'
import { LessonList } from '@/components/learn/LessonList'
import { UploadCard } from '@/components/learn/UploadCard'
import { PageHeader } from '@/components/page/PageHeader'

export function Lessons() {
  const { t } = useTranslation()
  const lessons = useLessons()
  return (
    <div className="flex flex-col gap-6 pb-8">
      <PageHeader title={t('learn.title')} subtitle={t('learn.subtitle')} back />
      <UploadCard />
      <Section title={t('learn.mine')}>
        {lessons.isLoading && <ListSkeleton rows={2} />}
        {lessons.isError && <Note tone="warn">{t('learn.loadError')}</Note>}
        {lessons.data && (lessons.data.mine.length ? <LessonList items={lessons.data.mine} /> : <Note>{t('learn.mineEmpty')}</Note>)}
      </Section>
      {lessons.data && lessons.data.shared.length > 0 && (
        <Section title={t('learn.sharedTitle')} hint={t('learn.sharedHint')}>
          <LessonList items={lessons.data.shared} />
        </Section>
      )}
    </div>
  )
}
