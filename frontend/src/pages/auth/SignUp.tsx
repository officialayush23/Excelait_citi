import { Building2, GraduationCap, HeartHandshake, Loader2, MailCheck, School, Users } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SELF_SERVICE_ROLES, type Role } from '@/config/roles'
import { supabaseConfigured } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { AuthLayout } from '@/pages/auth/AuthLayout'
import { useUi } from '@/stores/ui'

const ROLE_ICON: Partial<Record<Role, typeof GraduationCap>> = {
  student: GraduationCap,
  facilitator: School,
  parent: Users,
  mentor: HeartHandshake,
  partner: Building2,
}

export function SignUp() {
  const { t } = useTranslation()
  const { signUp } = useAuth()
  const language = useUi((s) => s.language)
  const navigate = useNavigate()
  const [step, setStep] = useState<'role' | 'details' | 'check-email'>('role')
  const [role, setRole] = useState<Role>('student')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { needsConfirmation } = await signUp({ email: email.trim(), password, fullName: fullName.trim(), role, language })
      if (needsConfirmation) setStep('check-email')
      else navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <div className="rounded-3xl border bg-card p-6 sm:p-8">
        <AnimatePresence mode="wait">
          {step === 'role' && (
            <motion.div key="role" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="flex flex-col gap-4">
              <h1 className="text-2xl font-semibold tracking-tight">{t('auth.iAm')}</h1>
              <div role="radiogroup" className="grid gap-2">
                {SELF_SERVICE_ROLES.map((r) => {
                  const Icon = ROLE_ICON[r] ?? GraduationCap
                  const on = role === r
                  return (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setRole(r)}
                      className={cn(
                        'flex items-center gap-4 rounded-2xl border p-4 text-left transition-colors',
                        on ? 'border-transparent bg-nav-active text-nav-active-foreground' : 'hover:bg-accent',
                      )}
                    >
                      <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', on ? 'bg-background/15' : 'bg-muted')}>
                        <Icon className="size-5" />
                      </span>
                      <span>
                        <span className="block font-semibold">{t(`roles.${r}.name`)}</span>
                        <span className={cn('block text-sm', on ? 'opacity-80' : 'text-muted-foreground')}>{t(`roles.${r}.desc`)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <Button size="lg" className="h-12 rounded-full text-base" onClick={() => setStep('details')}>
                {t('common.continue')}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {t('auth.haveAccount')}{' '}
                <Link to="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
                  {t('common.signIn')}
                </Link>
              </p>
            </motion.div>
          )}

          {step === 'details' && (
            <motion.form key="details" onSubmit={onSubmit} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="flex flex-col gap-5">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{t('auth.signUpTitle')}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t(`roles.${role}.name`)}</p>
              </div>
              {!supabaseConfigured && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{t('auth.notConfigured')}</p>}
              <div className="grid gap-2">
                <Label htmlFor="name">{t('common.fullName')}</Label>
                <Input id="name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-12 rounded-xl text-base" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">{t('common.email')}</Label>
                <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-xl text-base" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">{t('common.password')}</Label>
                <Input id="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl text-base" />
                <p className="text-xs text-muted-foreground">{t('auth.passwordHint')}</p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="lg" className="h-12 rounded-full" onClick={() => setStep('role')}>
                  {t('common.back')}
                </Button>
                <Button type="submit" size="lg" disabled={busy || !supabaseConfigured} className="h-12 flex-1 rounded-full text-base">
                  {busy && <Loader2 className="animate-spin" />}
                  {t('common.signUp')}
                </Button>
              </div>
            </motion.form>
          )}

          {step === 'check-email' && (
            <motion.div key="check" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-highlight text-highlight-foreground">
                <MailCheck className="size-7" />
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">{t('auth.checkEmailTitle')}</h1>
              <p className="text-muted-foreground">{t('auth.checkEmailBody', { email })}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AuthLayout>
  )
}
