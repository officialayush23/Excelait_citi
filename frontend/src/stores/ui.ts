import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'

type UiState = {
  theme: Theme
  language: string
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setLanguage: (lang: string) => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: prefersDark ? 'dark' : 'light',
      language: 'en',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      setLanguage: (language) => {
        document.documentElement.lang = language
        set({ language })
      },
    }),
    {
      name: 'excelait-ui',
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme)
          document.documentElement.lang = state.language
        }
      },
    },
  ),
)
