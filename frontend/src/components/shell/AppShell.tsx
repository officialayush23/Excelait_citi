import { Search, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { iconBtn, LanguageSwitcher, NotificationsButton, SignOutButton, ThemeToggle, UserMenu } from '@/components/shell/Controls'
import { Logo } from '@/components/shell/Logo'
import { BottomNav, RailNav } from '@/components/shell/Nav'
import { densityFor, NAV } from '@/config/roles'
import { cn } from '@/lib/utils'

/**
 * Students search by asking Saathi: the text is handed to the chat page,
 * which sends it on arrival. Other roles don't get a search box.
 */
function SearchPill({ className }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const message = q.trim()
    if (!message) return
    setQ('')
    navigate('/app/saathi', { state: { message } })
  }
  return (
    <form role="search" onSubmit={submit} className={cn('relative w-full max-w-sm', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('shell.search')}
        aria-label={t('shell.search')}
        className="h-11 w-full rounded-full bg-nav pr-4 pl-10 text-sm ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
    </form>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const items = NAV[role]
  const location = useLocation()
  const student = role === 'student'

  return (
    <div data-density={densityFor(role)} className="min-h-dvh bg-background">
      <div className="mx-auto flex max-w-[1520px] gap-4 lg:gap-5 lg:p-4">
        {/* Desktop rail */}
        <aside className="sticky top-4 hidden h-[calc(100dvh-2rem)] shrink-0 flex-col items-center gap-4 lg:flex">
          <Link to="/app" className="rounded-2xl focus-visible:outline-2" aria-label="ExcelAIt home">
            <Logo withWord={false} className="[&>span]:size-12 [&>span]:rounded-2xl" />
          </Link>
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
            <RailNav items={items} />
          </div>
          <SignOutButton />
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:top-4 lg:rounded-full lg:bg-transparent lg:backdrop-blur-none">
            <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:h-14 lg:px-0">
              <Link to="/app" className="shrink-0 rounded-xl focus-visible:outline-2 lg:hidden" aria-label="ExcelAIt home">
                <Logo withWord={!student} />
              </Link>
              {student ? (
                <SearchPill className="hidden md:block" />
              ) : (
                <p className="hidden truncate text-sm font-medium text-muted-foreground lg:block">{t(`roles.${role}.name`)}</p>
              )}
              <div className="ml-auto flex items-center gap-2">
                {student && (
                  <Link to="/app/saathi" aria-label={t('shell.askSaathi')} className={cn(iconBtn, 'md:hidden')}>
                    <Search className="size-[18px]" />
                  </Link>
                )}
                <LanguageSwitcher />
                <ThemeToggle />
                <span className="hidden sm:block">
                  <NotificationsButton />
                </span>
                {student && (
                  <Link
                    to="/app/saathi"
                    className="hidden h-10 items-center gap-2 rounded-full bg-cta px-5 text-sm font-semibold text-cta-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 sm:inline-flex"
                  >
                    <Sparkles aria-hidden="true" className="size-4" />
                    {t('shell.askSaathi')}
                  </Link>
                )}
                <UserMenu />
              </div>
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.main
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="px-4 pt-4 pb-32 sm:px-6 lg:px-0 lg:pt-5 lg:pb-8"
            >
              <Outlet />
            </motion.main>
          </AnimatePresence>
        </div>
      </div>

      <BottomNav items={items} />
    </div>
  )
}
