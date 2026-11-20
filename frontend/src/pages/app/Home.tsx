import { useAuth } from '@/auth/AuthProvider'
import { StudentHome } from '@/pages/app/StudentHome'
import { WorkspaceHome } from '@/pages/app/WorkspaceHome'

export function Home() {
  const { role } = useAuth()
  return role === 'student' ? <StudentHome /> : <WorkspaceHome />
}
