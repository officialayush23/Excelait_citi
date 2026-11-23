export type StepStatus = 'todo' | 'doing' | 'done' | 'skipped' | 'blocked'
export type Bucket = 'now' | 'next' | 'later' | 'done'
export type Pace = 'new' | 'on_track' | 'ahead' | 'behind' | 'inactive' | 'done'
export type RefLink = { kind: string; slug: string; name?: string | null }
export type Subtask = { id: string; key?: string; title: string; done: boolean }

export type RoadmapStep = {
  id: string
  goal_id: string
  position: number
  kind: string
  ref_id?: string | null
  title: string
  detail?: string | null
  due_date?: string | null
  days_left?: number | null
  done_at?: string | null
  status: StepStatus
  progress: number
  subtasks: Subtask[]
  hard_deadline: boolean
  at_risk: boolean
  refs: RefLink[]
  why?: string | null
  now_text?: string | null
  copy_key?: string | null
  optional?: boolean
  origin?: string
  parent_step_id?: string | null
  done_by?: 'student' | 'evidence' | null
  bucket: Bucket
}

export type Goal = {
  id: string
  kind: 'career' | 'program' | 'exam' | 'scheme' | 'job' | 'custom'
  title: string
  career_slug?: string | null
  exam_slug?: string | null
  scheme_slug?: string | null
  target_date?: string | null
  target_text?: string | null
  status: 'active' | 'paused' | 'done'
  progress: number
  pace: Pace
  steps: RoadmapStep[]
}

export type Change = {
  id: string
  goal_id?: string | null
  step_id?: string | null
  kind: string
  reason_code: string
  reason: string
  params?: Record<string, unknown>
  created_at: string
  undone_at?: string | null
  can_undo?: boolean
}

export type Watch = { id: string; kind: 'job' | 'exam' | 'scheme' | 'skill'; ref: string; label?: string | null; query?: Record<string, unknown> }
export type Alert = { id: string; kind: string; title: string; body?: string | null; link?: string | null; created_at: string; read_at?: string | null }

export type Roadmap = {
  ready: boolean
  today: string
  pace: Pace
  tone: string
  progress: number
  days_inactive: number
  fresh_start: boolean
  next: (RoadmapStep & { goal_title: string; goal_kind: string }) | null
  at_risk: { step_id: string; goal_id: string; title: string; days_left: number }[]
  goals: Goal[]
  changes: Change[]
  watches: Watch[]
  alerts: Alert[]
  signals: { kind: string; value: string }[]
  minor: boolean
  age_known: boolean
}
