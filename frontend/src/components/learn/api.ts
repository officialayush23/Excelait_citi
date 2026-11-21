import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError } from '@/lib/api'
import { supabase } from '@/lib/supabase'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

export type LessonStatus = 'processing' | 'ready' | 'failed'
export type LessonStage = 'reading' | 'writing' | 'recording' | 'done' | null

export type LessonSummary = {
  id: string
  owner_id: string
  title: string
  language: string
  status: LessonStatus
  stage: LessonStage
  is_public: boolean
  summary: string | null
  page_count: number | null
  created_at: string
}

export type Section = { heading: string; text: string; audio_url: string | null }
export type KeyTerm = { term: string; meaning: string }
export type QuizQuestion = { id: string; prompt: string; options: string[] }
export type Flashcard = { id: string; front: string; back: string }

/** OCR progress while a scanned PDF or photos are read; `notes` once written ('low_confidence', 'pages_skipped'). */
export type LessonProgressData = { ocr?: { done: number; total: number } } | null

export type Lesson = {
  id: string
  title: string
  language: string
  status: LessonStatus
  stage: LessonStage
  error: string | null
  is_public: boolean
  is_owner: boolean
  summary: string | null
  page_count: number | null
  created_at: string
  source?: 'pdf' | 'photo' | 'text' | null
  progress?: LessonProgressData
  notes?: string[]
  sections?: Section[]
  key_terms?: KeyTerm[]
  quiz?: { id: string; questions: QuizQuestion[] } | null
  flashcards?: Flashcard[]
}

export type CheckResult = { correct: boolean; answer_index: number; explanation: string }
export type QuizResult = {
  right: number
  total: number
  score: number
  results: { question_id: string; chosen: number | null; correct: boolean; answer_index: number; explanation: string }[]
}

const base = '/api/v1/learn/lessons'

export const useLessons = () =>
  useQuery({
    queryKey: ['lessons'],
    queryFn: () => api<{ mine: LessonSummary[]; shared: LessonSummary[] }>(base),
    refetchInterval: (q) => (q.state.data?.mine.some((l) => l.status === 'processing') ? 4000 : false),
  })

export const useLesson = (id?: string) =>
  useQuery({
    queryKey: ['lesson', id],
    queryFn: () => api<Lesson>(`${base}/${id}`),
    enabled: !!id,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 3000 : false),
  })

/** Multipart upload of one PDF or up to 10 photos (in reading order) as `files`; api() always sends JSON, so this one uses fetch directly. */
export async function uploadChapter(files: File[], language: string, title: string): Promise<{ id: string }> {
  const { data } = await supabase.auth.getSession()
  const form = new FormData()
  for (const f of files) form.append('files', f)
  form.append('language', language)
  if (title.trim()) form.append('title', title.trim())
  const res = await fetch(`${API_URL}${base}`, {
    method: 'POST',
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
    body: form,
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      message = ((await res.json()) as { detail?: string }).detail ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as { id: string }
}

export function useUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { files: File[]; language: string; title: string }) => uploadChapter(v.files, v.language, v.title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lessons'] }),
  })
}

export function useShare(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (is_public: boolean) => api<{ is_public: boolean }>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify({ is_public }) }),
    onSuccess: (r) => {
      qc.setQueryData<Lesson>(['lesson', id], (old) => (old ? { ...old, is_public: r.is_public } : old))
      void qc.invalidateQueries({ queryKey: ['lessons'] })
    },
  })
}

export function useDeleteLesson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lessons'] }),
  })
}

export const checkAnswer = (id: string, index: number, chosen: number) =>
  api<CheckResult>(`${base}/${id}/quiz/check`, { method: 'POST', body: JSON.stringify({ index, chosen }) })

export const submitQuiz = (id: string, answers: (number | null)[]) =>
  api<QuizResult>(`${base}/${id}/quiz`, { method: 'POST', body: JSON.stringify({ answers }) })
