import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { LanguageSwitcher, ThemeToggle } from '@/components/shell/Controls'
import { Logo } from '@/components/shell/Logo'

/** Public pages: a calm two-column layout with the brand panel on wide screens. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="ExcelAIt">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-4 pb-16 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:pt-10">
        <aside className="relative hidden overflow-hidden rounded-[2rem] bg-highlight p-10 text-highlight-foreground lg:flex lg:min-h-[34rem] lg:flex-col lg:justify-between">
          <p className="max-w-sm text-3xl leading-tight font-semibold tracking-tight">{t('auth.welcomeTitle')}</p>
          <div className="grid grid-cols-2 gap-3">
            {(['careers', 'money', 'learn', 'opportunities'] as const).map((k, i) => (
              <motion.div
                key={k}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.07 }}
                className="rounded-2xl bg-background/10 p-4 text-sm font-medium backdrop-blur-sm"
              >
                {t(`nav.${k}`)}
              </motion.div>
            ))}
          </div>
        </aside>
        <main className="flex items-start justify-center lg:items-center">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  )
}
