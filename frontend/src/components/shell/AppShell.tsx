import { AnimatePresence, motion } from 'motion/react'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { LanguageSwitcher, NotificationsButton, ThemeToggle, UserMenu } from '@/components/shell/Controls'
import { Logo } from '@/components/shell/Logo'
import { BottomNav, PillNav } from '@/components/shell/Nav'
import { densityFor, NAV } from '@/config/roles'

export function AppShell() {
  const { role } = useAuth()
  const items = NAV[role]
  const location = useLocation()

  return (
    <div data-density={densityFor(role)} className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <Link to="/app" className="shrink-0 rounded-xl focus-visible:outline-2" aria-label="ExcelAIt home">
            <Logo />
          </Link>
          <div className="flex flex-1 justify-center">
            <PillNav items={items} />
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <span className="hidden sm:block">
              <NotificationsButton />
            </span>
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
          className="mx-auto max-w-[1440px] px-4 pt-6 pb-28 sm:px-6 lg:pb-12"
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

      <BottomNav items={items} />
    </div>
  )
}
