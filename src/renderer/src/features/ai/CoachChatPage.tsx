import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Send, Square, Trash2 } from 'lucide-react'
import { CONTEXT_BUDGET } from '@core/ai/athlete-context'
import { splitCoachReply, type EditResolve } from '@core/ai/calendar-edits'
import type { AiMessage } from '@core/ai/types'
import { PROFESSIONAL } from '@core/persona'
import { coachContext, coachVoiceNow, streamAi, type StreamHandle } from '../../ai/client'
import { editsNote, trimChat, type ChatEditState, type ChatMessage } from '../../ai/chat-history'
import { handoffMessage, takeHandoff, type ChatHandoff } from '../../ai/handoff'
import { PersonaAvatar } from '../../coach/PersonaAvatar'
import { db } from '../../db/db'
import { useCoachPack } from '../../coach/custom'
import { applyCoachEdit, previewCoachEdit, resolveNow, undoCoachEdit, type EditSide } from '../../plan/coach-edits'
import { useSettings } from '../../stores/settings'
import { Button } from '../../ui/Button'
import { Markdown } from '../../ui/Markdown'
import { PageHeader } from '../../ui/PageHeader'
import { CoachEditCard } from './CoachEditCard'

const KV_KEY = 'coach.chat'
const SUGGESTIONS = [
  'Am I getting fitter? Be honest.',
  'What should I ride tomorrow?',
  'Give me a 45-minute workout that hurts.',
  'Why did my HR drift so much last ride?',
]
const DATA_PREFIX = 'My training data (JSON):\n'
/** What one chat message may hold (ai.stream.start in the IPC contract), less room for the wrapping. */
const MESSAGE_ROOM = 58_000
/** The least calendar and training data a message carries, however long the coach's instructions. */
const MIN_CONTEXT = 15_000
const SPICE = ['gentle', 'cheeky', 'snarky', 'savage', 'feral']

/** What the rider sees for their own message. Older chats stored the training data with it. */
function shownText(m: ChatMessage): string {
  if (m.asked !== undefined) return m.asked
  return m.content.startsWith(DATA_PREFIX) ? (m.content.split('Question: ').pop() ?? '') : m.content
}

/** A message from an older chat without the training data it carried, which only the latest message brings now. */
function withoutData(content: string): string {
  if (!content.startsWith(DATA_PREFIX)) return content
  const cut = content.indexOf('\n\n', DATA_PREFIX.length)
  return cut < 0 ? content : content.slice(cut + 2)
}

/**
 * The messages as sent. The latest rider message leads with `voice`, the
 * coach's current settings, and `data`, everything CrankHog knows about the
 * rider as of now; earlier messages go as written, so the coach always reads
 * one up-to-date copy. A coach reply says what the rider did with its
 * calendar changes.
 */
function forAi(history: readonly ChatMessage[], data: string, voice: string): AiMessage[] {
  const last = history.length - 1
  return history.map((m, i) => {
    const content = withoutData(m.content)
    if (m.role === 'assistant') return { role: m.role, content: `${content}${editsNote(m)}` }
    if (i !== last) return { role: m.role, content }
    return { role: m.role, content: `${voice}\n\n${DATA_PREFIX}${data}\n\n${m.shared ? content : `Question: ${content}`}` }
  })
}

/** Chat with the coach about your training (everything kept in CrankHog), in the persona picked in Settings. */
export function CoachChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [running, setRunning] = useState<StreamHandle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  // set synchronously, so a double click (or a click while a handoff loads) can't start a second request
  const busy = useRef(false)
  const stream = useRef<StreamHandle | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const coach = useSettings((s) => s.coach)
  const persona = useCoachPack(coach.personaId).meta
  // bumped when a change is applied or undone, so every card checks the calendar again
  const [calendarVersion, setCalendarVersion] = useState(0)
  // the chat as last rendered, for saving what the rider does with a change without waiting on a render
  const latest = useRef(messages)
  useEffect(() => {
    latest.current = messages
  }, [messages])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const ask = async (prior: readonly ChatMessage[], turn: ChatMessage) => {
    if (busy.current) return
    busy.current = true
    try {
      await askOnce(prior, turn)
    } finally {
      busy.current = false
      stream.current = null
    }
  }

  const askOnce = async (prior: readonly ChatMessage[], turn: ChatMessage) => {
    setError(null)
    const history = [...prior, turn]
    setMessages([...history, { role: 'assistant', content: '' }])
    // read for every message, so a ride, a plan or a calendar change since the last one is in it
    let data: string
    const voice = coachVoiceNow()
    try {
      // a long master prompt trims the calendar's detail rather than overfilling the message
      data = await coachContext(Date.now(), Math.max(MIN_CONTEXT, Math.min(CONTEXT_BUDGET, MESSAGE_ROOM - voice.length - turn.content.length)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setMessages([...prior])
      return
    }
    let acc = ''
    const h = streamAi('chat', forAi(history, data, voice), (d) => {
      acc += d
      setMessages([...history, { role: 'assistant', content: acc }])
    })
    stream.current = h
    setRunning(h)
    const res = await h.done
    setRunning(null)
    if (res.error) {
      setError(res.code === 'not-configured' ? 'not-configured' : res.error)
      setMessages(history)
      return
    }
    const final = trimChat([...history, { role: 'assistant', content: res.text ?? acc }])
    setMessages(final)
    await db().kv.put({ key: KV_KEY, value: final })
    input.current?.focus()
  }

  useEffect(() => {
    let live = true
    void db()
      .kv.get(KV_KEY)
      .then((row) => {
        if (!live) return
        const stored = Array.isArray(row?.value) ? (row.value as ChatMessage[]) : []
        setMessages(stored)
        // Something handed over from another page (the Fitness overview): share it, and let the coach say it's ready.
        const h = takeHandoff()
        if (h) void ask(stored, { role: 'user', content: handoffMessage(h), shared: h })
      })
    return () => {
      live = false
      // leaving the page stops the answer, so a stale stream can't overwrite a newer chat later
      stream.current?.cancel()
    }
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (text: string) => {
    if (!text.trim() || busy.current) return
    setDraft('')
    void ask(messages, { role: 'user', content: text.trim() })
  }

  /** Records what the rider did with change `index` of message `at`, and keeps it with the chat. */
  const setEdit = async (at: number, index: number, state: ChatEditState) => {
    const next = latest.current.map((m, i) => (i === at ? { ...m, edits: { ...m.edits, [index]: state } } : m))
    latest.current = next
    setMessages(next)
    await db().kv.put({ key: KV_KEY, value: next })
  }

  const apply = async (at: number, index: number, resolved: EditResolve & { ok: true }, shown: { before: EditSide | null; after: EditSide | null }) => {
    const undo = await applyCoachEdit(resolved)
    await setEdit(at, index, { status: 'applied', undo, shown })
    setCalendarVersion((v) => v + 1)
  }

  const undo = async (at: number, index: number) => {
    const state = latest.current[at]?.edits?.[index]
    if (!state?.undo) return
    await undoCoachEdit(state.undo)
    await setEdit(at, index, { status: 'undone' })
    setCalendarVersion((v) => v + 1)
  }

  const clear = async () => {
    setMessages([])
    await db().kv.delete(KV_KEY)
  }

  const language = persona.id === PROFESSIONAL.meta.id ? 'clean' : coach.profanity
  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-4 md:px-8 pb-6">
      <PageHeader
        title="Coach"
        subtitle="Ask about your training, plans and calendar. What you keep in CrankHog is shared with your AI provider, never Strava data."
        actions={
          messages.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void clear()}>
              <Trash2 className="size-3.5" /> New chat
            </Button>
          )
        }
      />
      <div className="mb-3 flex items-center gap-3 text-sm text-ink-dim" data-testid="chat-persona">
        <PersonaAvatar persona={persona} />
        <div className="min-w-0">
          <div className="font-semibold text-ink">{persona.name}</div>
          <div className="text-xs">
            {persona.id === PROFESSIONAL.meta.id ? 'Straight answers' : `Spice ${coach.spice} (${SPICE[coach.spice - 1]})`}, {language} language.{' '}
            <Link to="/settings" className="text-accent underline">
              Change the coach
            </Link>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto pb-4">
        {messages.length === 0 && (
          <div className="grid grid-cols-2 gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="rounded-xl border border-line bg-panel px-4 py-3 text-left text-sm text-ink-dim hover:border-line-strong hover:text-ink">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            m.shared ? (
              <SharedCard key={i} shared={m.shared} />
            ) : (
              <div key={i} className="ml-auto max-w-[80%] rounded-2xl bg-panel-3 px-4 py-3 text-sm">
                {shownText(m)}
              </div>
            )
          ) : (
            <div key={i} className="flex max-w-[90%] items-start gap-2.5">
              <PersonaAvatar persona={persona} className="mt-1" />
              <div className="min-w-0 rounded-2xl border border-line bg-panel px-4 py-3">
                {m.content ? (
                  <CoachReply
                    message={m}
                    writing={running !== null && i === messages.length - 1}
                    locked={running !== null}
                    calendarVersion={calendarVersion}
                    onApply={(index, r, shown) => apply(i, index, r, shown)}
                    onDismiss={(index) => void setEdit(i, index, { status: 'dismissed' })}
                    onUndo={(index) => undo(i, index)}
                  />
                ) : (
                  <span className="text-sm text-ink-faint">…</span>
                )}
              </div>
            </div>
          ),
        )}
        {error === 'not-configured' && (
          <div className="text-sm text-ink-dim">
            Pick an AI provider in{' '}
            <Link to="/settings" className="text-accent underline">
              Settings → AI
            </Link>{' '}
            first.
          </div>
        )}
        {error && error !== 'not-configured' && <div className="text-sm text-bad">{error}</div>}
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Ask ${persona.name}…`}
          aria-label="Message the coach"
          className="no-drag h-11 flex-1 rounded-xl border border-line bg-panel-2 px-4 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        {running ? (
          <Button type="button" onClick={() => running.cancel()} aria-label="Stop">
            <Square className="size-4" />
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={!draft.trim()} aria-label="Send">
            <Send className="size-4" />
          </Button>
        )}
      </form>
    </div>
  )
}

/** A coach reply: its text, and a card for each calendar change in it. */
function CoachReply({
  message,
  writing,
  locked,
  calendarVersion,
  onApply,
  onDismiss,
  onUndo,
}: {
  message: ChatMessage
  writing: boolean
  /** A reply is on its way: the cards wait, so what the rider does isn't lost when it lands. */
  locked: boolean
  calendarVersion: number
  onApply: (index: number, resolved: EditResolve & { ok: true }, shown: { before: EditSide | null; after: EditSide | null }) => Promise<void>
  onDismiss: (index: number) => void
  onUndo: (index: number) => Promise<void>
}) {
  // the same parts while the text is the same, so a card doesn't check the calendar on every render
  const parts = useMemo(() => splitCoachReply(message.content), [message.content])
  const [applyingAll, setApplyingAll] = useState<string | null>(null)
  const waiting = parts.filter((p) => p.kind === 'edit' && p.parse.ok && !message.edits?.[p.index])
  const applyAll = async () => {
    setApplyingAll('')
    const skipped: string[] = []
    for (const p of waiting) {
      if (p.kind !== 'edit' || !p.parse.ok) continue
      const r = await resolveNow(p.parse.edit)
      try {
        if (!r.ok) throw new Error(r.problem)
        await onApply(p.index, r, await previewCoachEdit(r))
      } catch (e) {
        skipped.push(`Change ${p.index + 1}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setApplyingAll(skipped.length > 0 ? skipped.join(' ') : null)
  }
  return (
    <>
      {parts.map((p, k) =>
        p.kind === 'text' ? (
          <Markdown key={k} text={p.text} />
        ) : p.kind === 'pending' ? (
          <p key={k} className="my-2 text-sm text-ink-faint">
            {writing ? 'Writing a change…' : 'This change was cut off before it was finished.'}
          </p>
        ) : (
          <CoachEditCard
            key={k}
            parse={p.parse}
            state={message.edits?.[p.index]}
            locked={locked}
            calendarVersion={calendarVersion}
            onApply={(r, shown) => onApply(p.index, r, shown)}
            onDismiss={() => onDismiss(p.index)}
            onUndo={() => onUndo(p.index)}
          />
        ),
      )}
      {!writing && waiting.length > 1 && (
        <Button size="sm" variant="secondary" disabled={applyingAll === '' || locked} onClick={() => void applyAll()}>
          Apply all {waiting.length} changes
        </Button>
      )}
      {applyingAll && <p className="mt-2 text-sm text-bad">{applyingAll}</p>}
    </>
  )
}

/** A handed-over page (the Fitness overview), folded to its title. */
function SharedCard({ shared }: { shared: ChatHandoff }) {
  return (
    <details className="group ml-auto max-w-[80%] rounded-2xl border border-line bg-panel-2 px-4 py-2.5 text-sm" data-testid="chat-shared">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-ink-dim">
        Shared your {shared.title.toLowerCase()} with the coach
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-2 leading-relaxed text-ink">{shared.text}</p>
    </details>
  )
}
