import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { LanguageSwitcher, ThemeToggle } from '@/components/shell/Controls'
import { Logo } from '@/components/shell/Logo'

/**
 * Public pages. On laptops and desktops the page is exactly one screen tall and never
 * scrolls: the brand panel and the form share the space below the header. On phones
 * the brand panel is hidden and the page scrolls normally.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col bg-background lg:h-dvh lg:overflow-hidden">
      <header className="mx-auto flex h-16 w-full max-w-6xl shrink-0 items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="ExcelAIt">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 px-4 pb-6 sm:px-6 lg:min-h-0 lg:items-center lg:pb-8">
        <div className="grid w-full gap-8 lg:h-full lg:max-h-[720px] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-14">
          <aside className="relative hidden min-h-0 flex-col justify-between overflow-hidden rounded-[2rem] bg-highlight p-10 text-highlight-foreground lg:flex">
            <div className="max-w-sm">
              <p className="text-3xl leading-tight font-semibold tracking-tight xl:text-[2.5rem]">{t('auth.welcomeTitle')}</p>
              <p className="mt-4 text-base leading-relaxed opacity-75">{t('auth.welcomeBody')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['careers', 'money', 'learn', 'opportunities'] as const).map((k, i) => (
                <motion.div
                  key={k}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.07 }}
                  className="rounded-2xl bg-background/10 px-4 py-3.5 text-sm font-medium"
                >
                  {t(`nav.${k}`)}
                </motion.div>
              ))}
            </div>
          </aside>

          {/* If a very short laptop screen cannot fit the form, only this column scrolls. */}
          <main className="flex min-h-0 justify-center lg:items-center lg:overflow-y-auto">
            <div className="w-full max-w-md py-1">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
