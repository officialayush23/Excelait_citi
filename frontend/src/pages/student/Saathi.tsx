import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Compass, History, Loader2, MessageSquareText, RotateCcw, SquarePen, Wallet, WifiOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthProvider'
import { CardActionsProvider } from '@/components/cards/kit'
import { CardList } from '@/components/cards/CardView'
import { Composer, SaathiAvatar, SuggestionChips, useOnline } from '@/components/cards/SaathiKit'
import type { Card } from '@/components/cards/types'
import { SpeakButton } from '@/components/shell/SpeakButton'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'
import { to } from '@/lib/links'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; cards: Card[] }
type ChatResponse = { thread_id: string; reply: string; cards: Card[]; tools: string[]; tokens: number }
type Thread = { id: string; title: string | null; updated_at: string }
type ThreadMessage = { id: number | string; role: 'user' | 'assistant'; content: string | null; cards: Card[] | null }

const THREADS_KEY = ['saathi', 'threads'] as const
let seq = 0
const newId = () => `m${Date.now()}-${seq++}`

/** Saathi: the student's guide. Short spoken replies, details as tappable cards. */
export function Saathi() {
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const language = useUi((s) => s.language)
  const online = useOnline()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const threadId = useRef<string | null>(null)
  const [activeThread, setActiveThread] = useState<string | null>(null)
  const busyRef = useRef(false)
  const started = useRef(false)
  const lastRef = useRef<HTMLLIElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const firstName = profile?.full_name?.split(' ')[0] || t('saathi.friend')

  const send = useCallback(
    async (message: string) => {
      const text = message.trim()
      if (!text || busyRef.current) return
      setFailed(null)
      setMsgs((m) => [...m, { id: newId(), role: 'user', content: text, cards: [] }])
      if (!navigator.onLine) {
        setFailed(text)
        return
      }
      busyRef.current = true
      setBusy(true)
      try {
        const res = await api<ChatResponse>('/api/v1/assistant/chat', {
          method: 'POST',
          body: JSON.stringify({ message: text, language, thread_id: threadId.current ?? undefined }),
        })
        threadId.current = res.thread_id
        setActiveThread(res.thread_id)
        setMsgs((m) => [...m, { id: newId(), role: 'assistant', content: res.reply ?? '', cards: res.cards ?? [] }])
        void qc.invalidateQueries({ queryKey: THREADS_KEY })
      } catch {
        setFailed(text)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [language, qc],
  )

  function retry() {
    if (!failed) return
    const text = failed
    // Drop the unanswered question so it is not shown twice.
    setMsgs((m) => (m.length && m[m.length - 1].role === 'user' && m[m.length - 1].content === text ? m.slice(0, -1) : m))
    void send(text)
  }

  function newChat() {
    threadId.current = null
    setActiveThread(null)
    setMsgs([])
    setFailed(null)
    setLoadError(false)
  }

  async function openThread(id: string) {
    setHistoryOpen(false)
    setFailed(null)
    setLoadError(false)
    setLoadingThread(true)
    try {
      const { messages } = await api<{ messages: ThreadMessage[] }>(`/api/v1/assistant/threads/${id}`)
      threadId.current = id
      setActiveThread(id)
      setMsgs(messages.map((m) => ({ id: `t${m.id}`, role: m.role, content: m.content ?? '', cards: m.cards ?? [] })))
    } catch {
      setLoadError(true)
    } finally {
      setLoadingThread(false)
    }
  }

  // A message started on Home (router state) is sent once, then cleared so a reload does not resend it.
  useEffect(() => {
    if (started.current) return
    started.current = true
    const first = (location.state as { message?: string } | null)?.message
    if (first) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
      void send(first)
    }
  }, [location, navigate, send])

  // New reply: show its start (cards can be tall). New question or typing: show the bottom.
  useEffect(() => {
    const last = msgs[msgs.length - 1]
    if (!last) return
    const el = last.role === 'assistant' ? lastRef.current : endRef.current
    el?.scrollIntoView({ behavior: 'smooth', block: last.role === 'assistant' ? 'start' : 'end' })
  }, [msgs])
  useEffect(() => {
    if (busy) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [busy])

  const threads = useQuery({
    queryKey: THREADS_KEY,
    queryFn: () => api<{ threads: Thread[] }>('/api/v1/assistant/threads').then((r) => r.threads),
    enabled: historyOpen && online,
    staleTime: 30_000,
  })

  const dateFmt = new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-IN' : `${i18n.language}-IN`, { day: 'numeric', month: 'short' })
  const empty = msgs.length === 0 && !loadingThread

  return (
    <CardActionsProvider value={{ send: (m) => void send(m), busy }}>
      <div className="mx-auto flex h-[calc(100dvh-12.5rem)] min-h-[26rem] max-w-3xl flex-col lg:h-[calc(100dvh-8.5rem)]">
        {/* header */}
        <div className="flex items-center gap-3 pb-3">
          <SaathiAvatar className="size-11" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">{t('saathi.title')}</h1>
            <p className="truncate text-sm text-muted-foreground">{t('saathi.tagline')}</p>
          </div>
          <Button variant="outline" onClick={() => setHistoryOpen(true)} className="h-11 rounded-full px-3 sm:px-4" aria-label={t('saathi.pastChats')}>
            <History className="size-5" />
            <span className="hidden sm:inline">{t('saathi.pastChats')}</span>
          </Button>
          <Button variant="outline" onClick={newChat} disabled={busy || empty} className="h-11 rounded-full px-3 sm:px-4" aria-label={t('saathi.newChat')}>
            <SquarePen className="size-5" />
            <span className="hidden sm:inline">{t('saathi.newChat')}</span>
          </Button>
        </div>

        {/* conversation */}
        <div className="-mx-1 flex-1 overflow-y-auto overscroll-contain px-1 pb-4">
          {loadingThread && (
            <div className="grid h-full place-items-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" aria-label={t('common.loading')} />
            </div>
          )}

          {empty && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex min-h-full flex-col justify-center gap-6 py-4">
              <div className="flex flex-col items-center gap-3 text-center">
                <SaathiAvatar className="size-16" />
                <div className="flex items-center gap-1">
                  <h2 className="text-2xl font-semibold tracking-tight">{t('saathi.greeting', { name: firstName })}</h2>
                  <SpeakButton text={`${t('saathi.greeting', { name: firstName })} ${t('saathi.greetingBody')}`} />
                </div>
                <p className="max-w-md text-muted-foreground">{t('saathi.greetingBody')}</p>
              </div>
              {online && <SuggestionChips onPick={(m) => void send(m)} disabled={busy} />}
            </motion.div>
          )}

          <ul className="flex flex-col gap-5" role="log" aria-live="polite" aria-label={t('saathi.conversation')}>
            <AnimatePresence initial={false}>
              {msgs.map((m, i) => (
                <motion.li
                  key={m.id}
                  ref={i === msgs.length - 1 ? lastRef : undefined}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={cn('flex scroll-mt-2', m.role === 'user' ? 'justify-end' : 'items-start gap-2.5')}
                >
                  {m.role === 'user' ? (
                    <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-highlight px-4 py-3 text-base break-words whitespace-pre-wrap text-highlight-foreground">
                      <span className="sr-only">{t('saathi.you')}: </span>
                      {m.content}
                    </p>
                  ) : (
                    <>
                      <SaathiAvatar className="mt-1" />
                      <div className="flex min-w-0 flex-1 flex-col gap-3">
                        {(m.content || !m.cards.length) && (
                          <div className="flex max-w-[95%] items-start gap-1 self-start rounded-3xl rounded-tl-lg border bg-card px-4 py-3 text-base">
                            <span className="sr-only">{t('saathi.title')}: </span>
                            <p className="whitespace-pre-wrap">{m.content || t('saathi.noReply')}</p>
                            {m.content && <SpeakButton text={m.content} className="-my-1 -mr-2" />}
                          </div>
                        )}
                        <CardList cards={m.cards} />
                      </div>
                    </>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          {busy && <Typing label={t('saathi.thinking')} />}

          {loadError && (
            <p role="alert" className="mt-4 rounded-2xl bg-tile-rose p-4 text-tile-foreground">
              {t('saathi.loadError')}
            </p>
          )}

          {failed && (
            <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-tile-rose p-4 text-tile-foreground">
              <p className="flex-1">{online ? t('saathi.error') : t('saathi.offlineShort')}</p>
              {online && (
                <Button variant="outline" onClick={retry} className="h-11 rounded-full bg-card px-4 text-foreground">
                  <RotateCcw className="size-4" />
                  {t('saathi.retry')}
                </Button>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* offline note + input */}
        {!online && (
          <div className="mb-3 flex flex-col gap-3 rounded-2xl border bg-card p-4" role="status">
            <p className="flex items-start gap-2">
              <WifiOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              {t('saathi.offline')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="h-11 rounded-full px-4">
                <Link to={to.careers()}>
                  <Compass className="size-4" />
                  {t('saathi.openCareers')}
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-full px-4">
                <Link to={to.money()}>
                  <Wallet className="size-4" />
                  {t('saathi.openMoney')}
                </Link>
              </Button>
            </div>
          </div>
        )}
        <Composer onSend={(v) => void send(v)} busy={busy} disabled={!online} className="border-t bg-background pt-3" />
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-[88%] gap-0 sm:max-w-sm">
          <SheetHeader>
            <SheetTitle className="text-xl">{t('saathi.pastChats')}</SheetTitle>
            <SheetDescription>{t('saathi.pastChatsBody')}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <Button
              onClick={() => {
                newChat()
                setHistoryOpen(false)
              }}
              className="mb-4 h-12 w-full rounded-full text-base"
            >
              <SquarePen className="size-5" />
              {t('saathi.newChat')}
            </Button>
            {!online ? (
              <p className="text-muted-foreground">{t('saathi.offlineShort')}</p>
            ) : threads.isLoading ? (
              <div className="grid place-items-center py-8 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-label={t('common.loading')} />
              </div>
            ) : threads.isError ? (
              <p className="text-muted-foreground">{t('saathi.error')}</p>
            ) : !threads.data?.length ? (
              <p className="text-muted-foreground">{t('saathi.noPastChats')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {threads.data.map((th) => (
                  <li key={th.id}>
                    <button
                      type="button"
                      onClick={() => void openThread(th.id)}
                      aria-current={th.id === activeThread ? 'true' : undefined}
                      className={cn(
                        'flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                        th.id === activeThread ? 'bg-accent' : 'bg-surface',
                      )}
                    >
                      <MessageSquareText aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{th.title || t('saathi.untitled')}</span>
                        <span className="block text-xs text-muted-foreground">{dateFmt.format(new Date(th.updated_at))}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </CardActionsProvider>
  )
}

function Typing({ label }: { label: string }) {
  return (
    <div className="mt-5 flex items-start gap-2.5" role="status">
      <SaathiAvatar className="mt-1" />
      <div className="flex items-center gap-1.5 rounded-3xl rounded-tl-lg border bg-card px-5 py-4">
        <span className="sr-only">{label}</span>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="size-2 rounded-full bg-muted-foreground"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </div>
  )
}
