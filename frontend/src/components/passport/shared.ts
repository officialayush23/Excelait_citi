import { supabase } from '@/lib/supabase'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

export type TaskStatus = 'todo' | 'submitted' | 'resubmit' | 'approved' | 'rejected'
export type I18n = Record<string, string> | null | undefined

export type SkillTask = { id: string; title: string; title_i18n: I18n; status: TaskStatus; credential_public_id: string | null }
export type Skill = {
  id: number
  slug: string
  name: string
  name_i18n: I18n
  nsqf_level: number | null
  for_my_careers: boolean
  careers: { slug: string; name: string; mine: boolean }[]
  tasks: SkillTask[]
}
export type Credential = {
  id: string
  public_id: string
  skill_id: number | null
  skill_name_i18n: I18n
  issued_at: string
  revoked_at: string | null
  payload: {
    id: string
    credentialSubject: { name: string; skill: string; level: string; task: string; evidenceCount: number; reviewer: string; school: string }
  }
}
export type Criterion = { id: string; name: string; pass_text?: string }
export type Review = { decision: string; comment: string; criteria: { id: string; ok: boolean; comment: string }[] }
export type Submission = {
  id: string
  status: TaskStatus
  note: string | null
  review: Review | null
  reviewed_at: string | null
  created_at: string
  evidence_urls: string[]
}

/** Picks the Hindi/Marathi name when there is one, else the English text. */
export function loc(text: string, i18n: I18n, lang: string) {
  return (i18n && i18n[lang]) || text
}

export function verifyUrl(publicId: string) {
  return `${window.location.origin}/verify/${publicId}`
}

export const MAX_PHOTOS = 3
export const MAX_BYTES = 4 * 1024 * 1024

/** Shrinks a phone photo to at most 1600px JPEG so it uploads fast on weak networks and stays under 4 MB. */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('not an image')
  if (file.size <= 1.5 * 1024 * 1024 && /jpe?g|png|webp/.test(file.type)) return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82))
  if (!blob) throw new Error('could not read image')
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
}

/** Multipart upload (the shared api() helper always sends JSON). */
export async function submitTask(taskId: string, files: File[], note: string) {
  const { data } = await supabase.auth.getSession()
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  form.append('note', note)
  const res = await fetch(`${API_URL}/api/v1/passport/tasks/${taskId}/submit`, {
    method: 'POST',
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
    body: form,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { detail?: string }).detail ?? msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json()
}
