import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import hi from './locales/hi.json'
import mr from './locales/mr.json'

/**
 * Languages ExcelAIt is designed for. A language with no locale file yet falls back
 * to English text; voice (Sarvam) still works in it. Adding a language = adding a JSON file.
 * `voice` is the BCP-47 code used for speech.
 */
export const LANGUAGES = [
  { code: 'en', label: 'English', voice: 'en-IN' },
  { code: 'hi', label: 'हिन्दी', voice: 'hi-IN' },
  { code: 'mr', label: 'मराठी', voice: 'mr-IN' },
  { code: 'bn', label: 'বাংলা', voice: 'bn-IN' },
  { code: 'ta', label: 'தமிழ்', voice: 'ta-IN' },
  { code: 'te', label: 'తెలుగు', voice: 'te-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ', voice: 'kn-IN' },
  { code: 'ml', label: 'മലയാളം', voice: 'ml-IN' },
  { code: 'gu', label: 'ગુજરાતી', voice: 'gu-IN' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', voice: 'pa-IN' },
  { code: 'od', label: 'ଓଡ଼ିଆ', voice: 'od-IN' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

/**
 * Feature areas keep their strings in i18n/parts/<area>.<lang>.json; they are merged
 * into the main translation so keys read as t('<area>.key').
 */
const parts = import.meta.glob<{ default: Record<string, unknown> }>('./parts/*.json', { eager: true })
const base: Record<string, Record<string, unknown>> = { en: { ...en }, hi: { ...hi }, mr: { ...mr } }
for (const [path, mod] of Object.entries(parts)) {
  const m = path.match(/\/([\w-]+)\.(\w+)\.json$/)
  if (!m) continue
  const [, area, lang] = m
  base[lang] = { ...(base[lang] ?? {}), [area]: mod.default }
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(Object.entries(base).map(([l, t]) => [l, { translation: t }])),
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
