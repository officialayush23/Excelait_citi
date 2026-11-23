import { Ellipsis } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'

import type { NavItem } from '@/config/roles'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export function pathFor(item: NavItem, index: number) {
  return index === 0 ? '/app' : `/app/${item.key}`
}

function useActiveIndex(items: NavItem[]) {
  const { pathname } = useLocation()
  const idx = items.findIndex((item, i) => (i === 0 ? pathname === '/app' || pathname === '/app/' : pathname.startsWith(`/app/${item.key}`)))
  return idx === -1 ? 0 : idx
}

/**
 * Desktop: the vertical icon rail from the reference. Each item is a circle with a
 * short label under it, because many first-time users can't read icons alone.
 */
export function RailNav({ items }: { items: NavItem[] }) {
  const { t } = useTranslation()
  const active = useActiveIndex(items)
  return (
    <nav aria-label="Main" className="flex flex-col items-center gap-1 rounded-[2rem] bg-nav px-1.5 py-2 ring-1 ring-border">
      {items.map((item, i) => {
        const Icon = item.icon
        const isActive = i === active
        return (
          <NavLink
            key={item.key}
            to={pathFor(item, i)}
            end={i === 0}
            aria-current={isActive ? 'page' : undefined}
            className="group flex w-[4.25rem] flex-col items-center gap-1 rounded-2xl py-1 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="relative grid size-11 place-items-center">
              {isActive && (
                <motion.span
                  layoutId="rail-pill"
                  className="absolute inset-0 rounded-full bg-nav-active"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <Icon
                aria-hidden="true"
                className={cn(
                  'relative size-5 transition-colors',
                  isActive ? 'text-nav-active-foreground' : 'text-muted-foreground group-hover:text-foreground',
                )}
              />
            </span>
            <span
              className={cn(
                'max-w-full truncate px-0.5 text-[11px] leading-tight font-medium',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {t(`nav.${item.key}`)}
            </span>
          </NavLink>
        )
      })}
    </nav>
  )
}

/** Phones: a floating bottom bar with big icons and short labels. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const { t } = useTranslation()
  const active = useActiveIndex(items)
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const overflow = items.length > 5
  const visible = overflow ? items.slice(0, 4) : items
  const rest = overflow ? items.slice(4) : []
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-around rounded-[1.75rem] bg-nav/95 px-1.5 py-1.5 shadow-lg ring-1 ring-border backdrop-blur">
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
        {overflow && (
          <li className="flex-1">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className={cn('relative flex w-full flex-col items-center gap-1 rounded-2xl py-1.5 text-[11px] font-medium',
                    active >= 4 ? 'text-foreground' : 'text-muted-foreground')}
                >
                  <span className={cn('grid h-8 w-14 place-items-center rounded-full', active >= 4 && 'bg-nav-active text-nav-active-foreground')}>
                    <Ellipsis className="size-5" aria-hidden="true" />
                  </span>
                  <span>{tr('nav.more')}</span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-3xl pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <SheetHeader>
                  <SheetTitle>{tr('nav.more')}</SheetTitle>
                </SheetHeader>
                <ul className="grid grid-cols-3 gap-2 px-4">
                  {rest.map((item, j) => {
                    const Icon = item.icon
                    return (
                      <li key={item.key}>
                        <NavLink
                          to={pathFor(item, j + 4)}
                          onClick={() => setOpen(false)}
                          className="flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-sm font-medium hover:bg-accent"
                        >
                          <Icon className="size-6" aria-hidden="true" />
                          {tr(`nav.${item.key}`)}
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </SheetContent>
            </Sheet>
          </li>
        )}
      </ul>
    </nav>
  )
}
