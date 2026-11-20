import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { AppShell } from '@/components/shell/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Home } from '@/pages/app/Home'
import { Section } from '@/pages/app/Section'
import { AuthCallback } from '@/pages/auth/AuthCallback'
import { SignIn } from '@/pages/auth/SignIn'
import { SignUp } from '@/pages/auth/SignUp'
import { Welcome } from '@/pages/auth/Welcome'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
})

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, session } = useAuth()
  if (!ready) return <Splash />
  return session ? children : <Navigate to="/sign-in" replace />
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { ready, session } = useAuth()
  if (!ready) return <Splash />
  return session ? <Navigate to="/app" replace /> : children
}

const router = createBrowserRouter([
  { path: '/', element: <PublicOnly><Welcome /></PublicOnly> },
  { path: '/sign-in', element: <PublicOnly><SignIn /></PublicOnly> },
  { path: '/sign-up', element: <PublicOnly><SignUp /></PublicOnly> },
  { path: '/auth/callback', element: <AuthCallback /> },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: ':section', element: <Section /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <Toaster position="top-center" />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
