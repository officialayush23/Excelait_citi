import { Loader2 } from 'lucide-react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'

/** Landing page for the email confirmation link; Supabase reads the token from the URL. */
export function AuthCallback() {
  const { ready, session } = useAuth()
  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return <Navigate to={session ? '/app' : '/sign-in'} replace />
}
