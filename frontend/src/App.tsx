import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
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
import { Careers } from '@/pages/student/Careers'
import { Money } from '@/pages/student/Money'
import { Start } from '@/pages/student/Start'
import { Saathi } from '@/pages/student/Saathi'
import { Profile } from '@/pages/student/Profile'
import { CareerPage } from '@/pages/explore/CareerPage'
import { CoursePage } from '@/pages/explore/CoursePage'
import { ExamPage } from '@/pages/explore/ExamPage'
import { Colleges } from '@/pages/explore/Colleges'
import { CollegePage } from '@/pages/explore/CollegePage'
import { Learn } from '@/pages/explore/Learn'
import { Plans } from '@/pages/explore/Plans'
import { PlanPage } from '@/pages/explore/PlanPage'
import { Community } from '@/pages/community/Community'
import { PostPage } from '@/pages/community/PostPage'
import { Opportunities } from '@/pages/community/Opportunities'
import { Organisation } from '@/pages/partner/Organisation'
import { Postings } from '@/pages/partner/Postings'
import { Applicants } from '@/pages/partner/Applicants'
import { Partners } from '@/pages/admin/Partners'
import { Moderation } from '@/pages/admin/Moderation'
import { Lessons } from '@/pages/learn/Lessons'
import { LessonPage } from '@/pages/learn/LessonPage'
import { Passport } from '@/pages/passport/Passport'
import { TaskPage } from '@/pages/passport/TaskPage'
import { VerifyCredential } from '@/pages/passport/VerifyCredential'
import { Cohort } from '@/pages/teacher/Cohort'
import { Students } from '@/pages/teacher/Students'
import { StudentDetail } from '@/pages/teacher/StudentDetail'
import { Verify } from '@/pages/teacher/Verify'
import { Modules } from '@/pages/teacher/Modules'
import { Trends } from '@/pages/trends/Trends'

import { useFacts, useOnlineSync } from '@/data/facts'

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

/** Loads the student's facts (phone first, then server) and drains queued changes when online. */
function StudentData({ children }: { children: ReactNode }) {
  const { session, role } = useAuth()
  const load = useFacts((s) => s.load)
  const userId = session?.user.id
  useOnlineSync()
  useEffect(() => {
    if (userId && role === 'student') void load(userId)
  }, [userId, role, load])
  return children
}

function Only({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { roles: mine } = useAuth()
  return mine.some((r) => roles.includes(r)) ? children : <Navigate to="/app" replace />
}
const StudentOnly = ({ children }: { children: ReactNode }) => <Only roles={['student']}>{children}</Only>
const PartnerOnly = ({ children }: { children: ReactNode }) => <Only roles={['partner', 'admin']}>{children}</Only>
const TeacherOnly = ({ children }: { children: ReactNode }) => <Only roles={['facilitator', 'admin']}>{children}</Only>
const AdminOnly = ({ children }: { children: ReactNode }) => <Only roles={['admin', 'facilitator']}>{children}</Only>

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
  { path: '/verify/:publicId', element: <VerifyCredential /> },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <StudentData>
          <AppShell />
        </StudentData>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: 'start', element: <StudentOnly><Start /></StudentOnly> },
      { path: 'careers', element: <StudentOnly><Careers /></StudentOnly> },
      { path: 'money', element: <StudentOnly><Money /></StudentOnly> },
      { path: 'saathi', element: <StudentOnly><Saathi /></StudentOnly> },
      { path: 'profile', element: <StudentOnly><Profile /></StudentOnly> },
      { path: 'careers/:slug', element: <StudentOnly><CareerPage /></StudentOnly> },
      { path: 'courses/:slug', element: <StudentOnly><CoursePage /></StudentOnly> },
      { path: 'exams/:slug', element: <StudentOnly><ExamPage /></StudentOnly> },
      { path: 'colleges', element: <Colleges /> },
      { path: 'colleges/:code', element: <CollegePage /> },
      { path: 'learn', element: <StudentOnly><Learn /></StudentOnly> },
      { path: 'plan', element: <StudentOnly><Plans /></StudentOnly> },
      { path: 'plan/:id', element: <StudentOnly><PlanPage /></StudentOnly> },
      { path: 'community', element: <Community /> },
      { path: 'community/:id', element: <PostPage /> },
      { path: 'opportunities', element: <StudentOnly><Opportunities /></StudentOnly> },
      { path: 'organisation', element: <PartnerOnly><Organisation /></PartnerOnly> },
      { path: 'postings', element: <PartnerOnly><Postings /></PartnerOnly> },
      { path: 'applicants', element: <PartnerOnly><Applicants /></PartnerOnly> },
      { path: 'partners', element: <AdminOnly><Partners /></AdminOnly> },
      { path: 'moderation', element: <AdminOnly><Moderation /></AdminOnly> },
      { path: 'trends', element: <Trends /> },
      { path: 'lessons', element: <Lessons /> },
      { path: 'lessons/:id', element: <LessonPage /> },
      { path: 'passport', element: <StudentOnly><Passport /></StudentOnly> },
      { path: 'passport/tasks/:id', element: <StudentOnly><TaskPage /></StudentOnly> },
      { path: 'cohort', element: <TeacherOnly><Cohort /></TeacherOnly> },
      { path: 'students', element: <TeacherOnly><Students /></TeacherOnly> },
      { path: 'students/:id', element: <TeacherOnly><StudentDetail /></TeacherOnly> },
      { path: 'verify', element: <TeacherOnly><Verify /></TeacherOnly> },
      { path: 'modules', element: <TeacherOnly><Modules /></TeacherOnly> },
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
