import {
  BadgeCheck,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Compass,
  Flag,
  Home,
  Inbox,
  LayoutDashboard,
  Library,
  Megaphone,
  MessagesSquare,
  Scale,
  ShieldCheck,
  TrendingUp,
  Users,
  UserSearch,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export type Role = 'student' | 'facilitator' | 'parent' | 'mentor' | 'partner' | 'funder' | 'admin'

/** Roles a person can pick at sign-up. Funder and admin are granted by an admin. */
export const SELF_SERVICE_ROLES: Role[] = ['student', 'facilitator', 'parent', 'mentor', 'partner']

/** When a user holds several roles, the first match decides their home. */
export const ROLE_PRIORITY: Role[] = ['admin', 'funder', 'facilitator', 'partner', 'mentor', 'parent', 'student']

export type NavItem = {
  /** i18n key under nav.* and the URL segment */
  key: string
  icon: LucideIcon
  /** Build phase that delivers this section (see the product plan). */
  phase: number
}

export const NAV: Record<Role, NavItem[]> = {
  student: [
    { key: 'home', icon: Home, phase: 1 },
    { key: 'careers', icon: Compass, phase: 2 },
    { key: 'money', icon: Wallet, phase: 2 },
    { key: 'plan', icon: Flag, phase: 2 },
    { key: 'learn', icon: BookOpen, phase: 3 },
    { key: 'opportunities', icon: Briefcase, phase: 5 },
    { key: 'community', icon: MessagesSquare, phase: 5 },
    { key: 'passport', icon: BadgeCheck, phase: 4 },
  ],
  facilitator: [
    { key: 'cohort', icon: LayoutDashboard, phase: 4 },
    { key: 'students', icon: Users, phase: 4 },
    { key: 'verify', icon: ClipboardCheck, phase: 4 },
    { key: 'modules', icon: Library, phase: 6 },
    { key: 'community', icon: MessagesSquare, phase: 5 },
  ],
  partner: [
    { key: 'postings', icon: Megaphone, phase: 5 },
    { key: 'applicants', icon: UserSearch, phase: 5 },
    { key: 'organisation', icon: Building2, phase: 5 },
  ],
  mentor: [
    { key: 'inbox', icon: Inbox, phase: 5 },
    { key: 'sessions', icon: CalendarDays, phase: 5 },
    { key: 'community', icon: MessagesSquare, phase: 5 },
  ],
  parent: [
    { key: 'home', icon: Home, phase: 6 },
    { key: 'consent', icon: ShieldCheck, phase: 6 },
  ],
  funder: [{ key: 'outcomes', icon: TrendingUp, phase: 6 }],
  admin: [
    { key: 'partners', icon: BadgeCheck, phase: 5 },
    { key: 'schemes', icon: Scale, phase: 2 },
    { key: 'careers', icon: Compass, phase: 2 },
    { key: 'moderation', icon: ShieldCheck, phase: 5 },
  ],
}

export function primaryRole(roles: string[]): Role {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? 'student'
}

/** Students get the simpler, larger layout; everyone else the denser dashboard. */
export function densityFor(role: Role): 'comfortable' | 'compact' {
  return role === 'student' || role === 'parent' ? 'comfortable' : 'compact'
}
