// The coach chat as stored in Dexie, and how it is kept to a size the IPC
// contract (60 messages) and the providers accept.
import { editCount } from '@core/ai/calendar-edits'
import type { AiMessage } from '@core/ai/types'
import type { CoachUndo } from '../plan/coach-edits'
import type { ChatHandoff } from './handoff'

/** What the rider did with one of the coach's calendar changes (src/core/ai/calendar-edits.ts). */
export interface ChatEditState {
  status: 'applied' | 'dismissed' | 'undone'
  /** How to put an applied change back. */
  undo?: CoachUndo
}

/** A chat turn as stored. `shared` marks a context handoff, shown as a card rather than the raw prompt. */
export interface ChatMessage extends AiMessage {
  shared?: ChatHandoff
  /** Older chats: what the rider typed, when the stored content also carried the training data. */
  asked?: string
  /** A coach reply's calendar changes, by their place in the reply (from 0), once the rider has acted on them. */
  edits?: Record<number, ChatEditState>
}

export const MAX_KEPT = 40

/**
 * The chat trimmed to its newest `max` messages, from a rider message on, so
 * rider and coach still alternate. No older message has to stay: the latest
 * one carries the training data.
 */
export function trimChat(messages: readonly ChatMessage[], max = MAX_KEPT): ChatMessage[] {
  if (messages.length <= max) return [...messages]
  let tail = messages.slice(-max)
  while (tail.length > 0 && tail[0]!.role !== 'user') tail = tail.slice(1)
  return tail
}

/** What the rider did with a coach reply's calendar changes, for the coach to read next time: "[Calendar changes: 1 applied, 2 dismissed]". */
export function editsNote(m: ChatMessage): string {
  const count = m.role === 'assistant' ? editCount(m.content) : 0
  if (count === 0) return ''
  const said = { applied: 'applied', dismissed: 'dismissed', undone: 'applied, then undone' } as const
  const parts = Array.from({ length: count }, (_, i) => `${i + 1} ${m.edits?.[i] ? said[m.edits[i].status] : 'not applied yet'}`)
  return `\n\n[Calendar changes: ${parts.join(', ')}]`
}
