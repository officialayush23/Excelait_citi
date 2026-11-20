import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { TextEffect } from '@/components/motion-primitives/text-effect'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/pages/auth/AuthLayout'

export function Welcome() {
  const { t, i18n } = useTranslation()
  const title = t('auth.welcomeTitle')
  return (
    <AuthLayout>
      <div className="flex flex-col gap-6 pt-6 lg:pt-0">
        <div className="flex items-start gap-1">
          <TextEffect key={i18n.language} as="h1" per="word" preset="fade-in-blur" className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            {title}
          </TextEffect>
          <SpeakButton text={`${title}. ${t('auth.welcomeBody')}`} className="mt-2" />
        </div>
        <p className="text-lg text-muted-foreground">{t('auth.welcomeBody')}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
            <Link to="/sign-up">
              {t('common.signUp')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6 text-base">
            <Link to="/sign-in">{t('common.signIn')}</Link>
          </Button>
        </div>
      </div>
    </AuthLayout>
  )
}
