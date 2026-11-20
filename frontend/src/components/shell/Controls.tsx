import { Bell, Check, Languages, LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/AuthProvider'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import i18n, { LANGUAGES } from '@/i18n'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

const iconBtn =
  'grid size-10 place-items-center rounded-full border bg-nav text-foreground/80 transition-colors hover:text-foreground hover:bg-accent focus-visible:outline-2'

export function ThemeToggle() {
  const { t } = useTranslation()
  const { theme, toggleTheme } = useUi()
  const label = `${t('common.theme')}: ${theme === 'dark' ? t('common.dark') : t('common.light')}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={iconBtn} onClick={toggleTheme} aria-label={label}>
          {theme === 'dark' ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { language, setLanguage } = useUi()
  const { session } = useAuth()

  async function choose(code: string) {
    setLanguage(code)
    await i18n.changeLanguage(code)
    if (session) {
      await supabase.from('profiles').update({ preferred_language: code }).eq('id', session.user.id)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(iconBtn, className)} aria-label={t('common.language')}>
          <Languages className="size-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t('common.language')}</DropdownMenuLabel>
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => void choose(l.code)} className="justify-between">
            <span lang={l.code}>{l.label}</span>
            {language === l.code && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function NotificationsButton() {
  const { t } = useTranslation()
  return (
    <button type="button" className={iconBtn} aria-label={t('common.notifications')}>
      <Bell className="size-[18px]" />
    </button>
  )
}

export function UserMenu() {
  const { t } = useTranslation()
  const { profile, role, signOut } = useAuth()
  const name = profile?.full_name || profile?.email || ''
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full focus-visible:outline-2" aria-label={t('common.profile')}>
          <Avatar className="size-10 border">
            <AvatarFallback className="bg-highlight text-sm font-semibold text-highlight-foreground">
              {initials || <UserRound className="size-4" />}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-semibold">{profile?.full_name || t('home.friend')}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{profile?.email}</span>
          <span className="mt-1 text-xs font-normal text-muted-foreground">{t(`roles.${role}.name`)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" />
          {t('common.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
