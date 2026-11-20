import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'

import type { NavItem } from '@/config/roles'
import { cn } from '@/lib/utils'

export function pathFor(item: NavItem, index: number) {
  return index === 0 ? '/app' : `/app/${item.key}`
}

function useActiveIndex(items: NavItem[]) {
  const { pathname } = useLocation()
  const idx = items.findIndex((item, i) => (i === 0 ? pathname === '/app' || pathname === '/app/' : pathname.startsWith(`/app/${item.key}`)))
  return idx === -1 ? 0 : idx
}

/** Desktop: the pill-shaped tab bar from the dark reference. */
export function PillNav({ items }: { items: NavItem[] }) {
  const { t } = useTranslation()
  const active = useActiveIndex(items)
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 rounded-full border bg-nav p-1 lg:flex">
      {items.map((item, i) => {
        const Icon = item.icon
        const isActive = i === active
        return (
          <NavLink
            key={item.key}
            to={pathFor(item, i)}
            end={i === 0}
            className={cn(
              'relative flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors',
              isActive ? 'text-nav-active-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {isActive && (
              <motion.span
                layoutId="nav-pill"
                className="absolute inset-0 rounded-full bg-nav-active"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <Icon className="relative size-4" aria-hidden="true" />
            <span className="relative">{t(`nav.${item.key}`)}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

/** Phones: a bottom bar with big icons and short labels. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const { t } = useTranslation()
  const active = useActiveIndex(items)
  const visible = items.slice(0, 5)
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-nav/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around px-2 py-1.5">
        {visible.map((item, i) => {
          const Icon = item.icon
          const isActive = i === active
          return (
            <li key={item.key} className="flex-1">
              <NavLink
                to={pathFor(item, i)}
                end={i === 0}
                className={cn(
                  'relative flex flex-col items-center gap-1 rounded-2xl py-1.5 text-[11px] font-medium',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="relative grid h-8 w-14 place-items-center">
                  {isActive && (
                    <motion.span
                      layoutId="bottom-pill"
                      className="absolute inset-0 rounded-full bg-nav-active"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <Icon className={cn('relative size-5', isActive && 'text-nav-active-foreground')} aria-hidden="true" />
                </span>
                <span className="truncate">{t(`nav.${item.key}`)}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
