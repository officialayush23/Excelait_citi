import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'
const cache = new Map<string, string>()
let current: HTMLAudioElement | null = null

export function stopSpeaking() {
  current?.pause()
  current = null
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

/**
 * Reads text aloud with a natural Indian voice (Sarvam Bulbul) when online;
 * falls back to the phone's own voice when offline or if the service fails.
 */
export async function speak(text: string, language: string, voice: string, onEnd: () => void) {
  stopSpeaking()
  const key = `${language}:${text}`
  try {
    if (!navigator.onLine) throw new Error('offline')
    let src = cache.get(key)
    if (!src) {
      const { audio_base64, mime } = await api<{ audio_base64: string; mime: string }>('/api/v1/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text: text.slice(0, 1500), language }),
      })
      src = `data:${mime};base64,${audio_base64}`
      cache.set(key, src)
    }
    const audio = new Audio(src)
    current = audio
    audio.onended = onEnd
    audio.onerror = onEnd
    await audio.play()
  } catch {
    if (!('speechSynthesis' in window)) return onEnd()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = voice
    u.rate = 0.95
    u.onend = onEnd
    u.onerror = onEnd
    window.speechSynthesis.speak(u)
  }
}

/** Records from the microphone until stop() is called. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  recorder.start()
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        }
        recorder.stop()
      }),
  }
}

export async function transcribe(audio: Blob, language: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const form = new FormData()
  const ext = audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'
  form.append('file', audio, `voice.${ext}`)
  form.append('language', language)
  const res = await fetch(`${API_URL}/api/v1/voice/stt`, {
    method: 'POST',
    headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
    body: form,
  })
  if (!res.ok) throw new Error('stt failed')
  return ((await res.json()) as { transcript: string }).transcript
}
