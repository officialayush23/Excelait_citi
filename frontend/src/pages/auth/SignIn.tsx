import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabaseConfigured } from '@/lib/supabase'
import { AuthLayout } from '@/pages/auth/AuthLayout'

export function SignIn() {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={onSubmit} className="flex flex-col gap-5 rounded-3xl border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('auth.signInTitle')}</h1>
        {!supabaseConfigured && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{t('auth.notConfigured')}</p>}
        <div className="grid gap-2">
          <Label htmlFor="email">{t('common.email')}</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-xl text-base" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">{t('common.password')}</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl text-base" />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy || !supabaseConfigured} className="h-12 rounded-full text-base">
          {busy && <Loader2 className="animate-spin" />}
          {t('common.signIn')}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {t('auth.noAccount')}{' '}
          <Link to="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t('common.signUp')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
