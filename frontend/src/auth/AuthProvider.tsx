import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { primaryRole, type Role } from '@/config/roles'
import i18n from '@/i18n'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { useUi } from '@/stores/ui'

export type Profile = {
  id: string
  full_name: string | null
  email: string | null
  preferred_language: string
}

type AuthState = {
  ready: boolean
  session: Session | null
  profile: Profile | null
  roles: Role[]
  role: Role
  signIn: (email: string, password: string) => Promise<void>
  signUp: (args: { email: string; password: string; fullName: string; role: Role; language: string }) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // With no Supabase keys there is nothing to wait for.
  const [ready, setReady] = useState(!supabaseConfigured)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const setLanguage = useUi((s) => s.setLanguage)

  const load = useCallback(
    async (s: Session | null) => {
      if (!s) {
        setProfile(null)
        setRoles([])
        return
      }
      // Both reads are limited to the user's own rows by row-level security.
      const [p, r] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, preferred_language').eq('id', s.user.id).maybeSingle(),
        supabase.from('user_roles').select('role').eq('user_id', s.user.id),
      ])
      if (p.data) {
        setProfile(p.data as Profile)
        if (p.data.preferred_language) {
          setLanguage(p.data.preferred_language)
          void i18n.changeLanguage(p.data.preferred_language)
        }
      }
      setRoles(((r.data ?? []) as { role: Role }[]).map((x) => x.role))
    },
    [setLanguage],
  )

  useEffect(() => {
    if (!supabaseConfigured) return
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await load(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Defer DB reads out of the auth callback, as Supabase recommends.
      setTimeout(() => void load(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      profile,
      roles,
      role: primaryRole(roles),
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signUp({ email, password, fullName, role, language }) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, role, language },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        })
        if (error) throw error
        return { needsConfirmation: !data.session }
      },
      async signOut() {
        await supabase.auth.signOut()
      },
      async refresh() {
        await load(session)
      },
    }),
    [ready, session, profile, roles, load],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
