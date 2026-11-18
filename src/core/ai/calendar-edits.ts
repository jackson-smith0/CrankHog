// Changes the coach proposes to the calendar. The coach chat can't touch the
// calendar itself: it writes each change as a fenced block in its reply, and
// the rider presses Apply on the card the chat draws from it. The block reads
// like a session file (docs/WORKOUT-FORMAT.md): header lines, a blank line,
// then the steps.
//
//   ```crankhog
//   action: change
//   ref: k3x9qa
//   sport: run
//   name: Easy run 40
//   why: The walk breaks feel pointless now.
//
//   - 40m Z2 HR
//   ```
//
// A ride's steps are intervals.icu bike text; any other sport's are session
// steps. Each calendar entry the coach reads carries a short `ref` (entryRef)
// that names it here. Everything is checked twice: once when the reply is
// read (parseCalendarEdit, the block on its own) and once against the
// calendar as it is when the card is drawn (resolveEdit).
import type { SessionSport } from '../multisport/model'
import { parseSession, type ParsedSession } from '../multisport/parse'
import { guardrailMatch } from '../persona/guardrails'
import { isSportGroup, SPORT_GROUP_LABEL, type SportGroup } from '../sport/group'
import { isEffort, type Effort } from '../sport/load'
import { fnv1a32 } from '../workout/ids'
import { parseIntervalsText } from '../workout/io/intervals-text'
import { parseDuration } from '../workout/io/text-tokens'
import type { Workout } from '../workout/model'
import { dateKey, dateKeyToMs, isDateKey, type DateKey, type ScheduledWorkout } from '../workout/schedule'

/** The fence the coach writes a change in: ```crankhog. */
export const EDIT_FENCE = 'crankhog'

export const EDIT_ACTIONS = ['change', 'move', 'add', 'remove'] as const
export type EditAction = (typeof EDIT_ACTIONS)[number]

const MAX_NAME = 80
const MAX_NOTES = 300
const MAX_WHY = 200
const MAX_STEPS = 6000

/** A calendar entry's short name in the coach's data: six base-36 characters, the same every time for the same entry. */
export function entryRef(id: string): string {
  return (parseInt(fnv1a32(id), 16) % 36 ** 6).toString(36).padStart(6, '0')
}

/** What a change or an addition puts on the day. */
export type EditContent =
  /** A run, swim or other session: a whole session file, header and steps. */
  | { kind: 'session'; sport: SessionSport; file: string; parsed: ParsedSession }
  /** A bike workout from intervals.icu text. */
  | { kind: 'bike'; text: string; workout: Workout }
  /** A ride without steps: how long and how hard. */
  | { kind: 'plain-ride'; durationS: number; effort?: Effort }

export interface CalendarEdit {
  action: EditAction
  ref?: string
  date?: DateKey
  sport?: SportGroup
  name?: string
  notes?: string
  why?: string
  /** The steps as written, when there are any. */
  steps?: string
  /** What goes on the day; missing for a move, a removal, or a change of only the name or notes. */
  content?: EditContent
  /** Things to know that don't stop it, such as a session parser warning. */
  warnings: string[]
}

export type EditParse = { ok: true; edit: CalendarEdit } | { ok: false; error: string }

export type ReplyPart =
  | { kind: 'text'; text: string }
  /** One change block, with `index` counting the reply's changes from 0. */
  | { kind: 'edit'; index: number; source: string; parse: EditParse }
  /** A change block not closed yet: still being written, or cut off. */
  | { kind: 'pending' }

const FENCE_OPEN = new RegExp(`^\\s*\`\`\`\\s*${EDIT_FENCE}\\b`, 'i')
const FENCE_CLOSE = /^\s*```\s*$/

/** A reply cut into its text and its change blocks, in order. */
export function splitCoachReply(text: string): ReplyPart[] {
  const parts: ReplyPart[] = []
  const lines = text.split(/\r?\n/)
  let prose: string[] = []
  let index = 0
  const flush = () => {
    const t = prose.join('\n').trim()
    if (t) parts.push({ kind: 'text', text: t })
    prose = []
  }
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_OPEN.test(lines[i]!)) {
      prose.push(lines[i]!)
      continue
    }
    const end = lines.findIndex((l, j) => j > i && FENCE_CLOSE.test(l))
    flush()
    if (end < 0) {
      parts.push({ kind: 'pending' })
      return parts
    }
    const source = lines.slice(i + 1, end).join('\n')
    parts.push({ kind: 'edit', index: index++, source, parse: parseCalendarEdit(source) })
    i = end
  }
  flush()
  return parts
}

/** How many change blocks a reply has. */
export const editCount = (text: string): number => splitCoachReply(text).filter((p) => p.kind === 'edit').length

const HEADER = /^([a-z]+)\s*:\s*(.*)$/i
const SESSION_KEYS = ['pool', 'duration', 'distance', 'effort'] as const

/** Whether a "YYYY-MM-DD" names a real day (not 2026-02-30). */
export function isRealDay(s: string): s is DateKey {
  return isDateKey(s) && dateKey(dateKeyToMs(s)) === s
}

const SELF_HARM = "No coach tells anyone to hurt or kill themselves, so this change can't be used."

/** One change block read on its own: what it asks for, or why it can't be used. Never throws. */
export function parseCalendarEdit(block: string): EditParse {
  const lines = block.replace(/^\uFEFF/, '').split(/\r?\n/)
  const header: Record<string, string> = {}
  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) {
      if (Object.keys(header).length > 0) {
        i++
        break
      }
      continue
    }
    const m = HEADER.exec(line)
    if (!m || line.startsWith('-')) break
    header[m[1]!.toLowerCase()] = m[2]!.trim()
  }
  const steps = lines.slice(i).join('\n').trim()

  const action = header.action?.toLowerCase()
  if (!action || !(EDIT_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: 'The change has no action: it should say change, move, add or remove.' }
  const edit: CalendarEdit = { action: action as EditAction, warnings: [] }

  if (header.ref) edit.ref = header.ref.toLowerCase()
  if (action !== 'add' && !edit.ref) return { ok: false, error: 'The change doesn\'t say which session: it needs a "ref" from the calendar.' }
  if (header.date !== undefined) {
    if (!isRealDay(header.date)) return { ok: false, error: `"${header.date}" isn't a day: write it as YYYY-MM-DD.` }
    edit.date = header.date
  }
  if ((action === 'move' || action === 'add') && !edit.date) return { ok: false, error: `To ${action} a session the change needs a date.` }
  if (header.sport !== undefined) {
    const sport = header.sport.toLowerCase()
    if (!isSportGroup(sport)) return { ok: false, error: `"${header.sport}" isn't a sport here: use ride, run, swim or other.` }
    edit.sport = sport
  }
  if (header.name) edit.name = header.name.slice(0, MAX_NAME)
  if (header.notes) edit.notes = header.notes.slice(0, MAX_NOTES)
  if (header.why) edit.why = header.why.slice(0, MAX_WHY)
  if (steps.length > MAX_STEPS) return { ok: false, error: `The steps are ${steps.length} characters long; at most ${MAX_STEPS} are allowed.` }
  if (steps) edit.steps = steps

  for (const t of [edit.name, edit.notes, edit.why, edit.steps]) if (t && guardrailMatch(t)) return { ok: false, error: SELF_HARM }

  if (action === 'move' || action === 'remove') return { ok: true, edit }
  if (action === 'add' && !edit.sport) return { ok: false, error: 'To add a session the change needs a sport: ride, run, swim or other.' }

  const hasSessionHeader = SESSION_KEYS.some((k) => header[k] !== undefined)
  if (!steps && !hasSessionHeader) {
    if (action === 'add') return { ok: false, error: 'A new session needs steps, or a duration or distance.' }
    // a change of only the name or notes keeps what the session is
    return { ok: true, edit }
  }
  const sport = edit.sport
  if (!sport) return { ok: false, error: 'A change of steps needs the sport: ride, run, swim or other.' }

  if (sport === 'ride') {
    if (!steps) {
      const durationS = header.duration ? parseDuration(header.duration) : null
      if (!durationS || durationS <= 0) return { ok: false, error: 'A ride without steps needs a duration, like "duration: 45m".' }
      const effort = header.effort?.toLowerCase()
      if (effort !== undefined && !isEffort(effort)) return { ok: false, error: `effort is easy, moderate, hard or max, not "${header.effort}".` }
      edit.content = { kind: 'plain-ride', durationS, ...(effort ? { effort } : {}) }
      return { ok: true, edit }
    }
    const { workout, errors } = parseIntervalsText(steps, { name: edit.name ?? 'Ride', ...(edit.notes ? { description: edit.notes } : {}), source: 'ai', tags: ['coach'] })
    if (errors.length > 0) return { ok: false, error: `Step line ${errors[0]!.line}: ${errors[0]!.message}` }
    if (workout.segments.length === 0) return { ok: false, error: 'The ride has no steps CrankHog can read.' }
    edit.content = { kind: 'bike', text: steps, workout }
    return { ok: true, edit }
  }

  // a run, swim or other session: built as a session file, so it reads exactly as an imported one would
  const file = [
    `sport: ${sport}`,
    ...(edit.name ? [`name: ${edit.name}`] : []),
    ...SESSION_KEYS.filter((k) => header[k] !== undefined).map((k) => `${k}: ${header[k]}`),
    ...(edit.notes ? [`notes: ${edit.notes}`] : []),
    '',
    steps,
  ].join('\n')
  const parsed = parseSession(`${edit.name ?? SPORT_GROUP_LABEL[sport]}.txt`, file)
  if (parsed.errors.length > 0) {
    const e = parsed.errors[0]!
    // the line numbers are the file's; the coach wrote only the steps
    const headerLines = file.split('\n').length - steps.split('\n').length
    return { ok: false, error: e.line !== undefined && e.line > headerLines ? `Step line ${e.line - headerLines}: ${e.text}` : e.text }
  }
  edit.warnings.push(...parsed.warnings.map((w) => w.text))
  edit.content = { kind: 'session', sport, file: file.trim() + '\n', parsed }
  return { ok: true, edit }
}

export type EditResolve =
  | {
      ok: true
      edit: CalendarEdit
      /** The entry it acts on; missing for an addition. */
      entry?: ScheduledWorkout
      /** The sport after the change. */
      sport: SportGroup
      warnings: string[]
    }
  | { ok: false; problem: string }

const FROM_INTERVALS = 'This came from intervals.icu, and the next import would put it back. Change it there.'

/**
 * An edit checked against the calendar as it is now: the entry it names, or
 * in plain words why it can't be applied. `done` holds the ids of entries
 * already done (completions in src/core/workout/schedule.ts).
 */
export function resolveEdit(edit: CalendarEdit, schedule: readonly ScheduledWorkout[], done: ReadonlySet<string> | ReadonlyMap<string, unknown>, today: DateKey): EditResolve {
  const warnings = [...edit.warnings]
  if (edit.date && edit.date < today) return { ok: false, problem: "That day has passed, so nothing can be planned on it." }
  if (edit.action === 'add') return { ok: true, edit, sport: edit.sport ?? 'ride', warnings }

  const matches = schedule.filter((e) => entryRef(e.id) === edit.ref)
  if (matches.length === 0) return { ok: false, problem: "That session isn't on the calendar any more." }
  if (matches.length > 1) return { ok: false, problem: "CrankHog can't tell which session that is. Ask the coach to try again." }
  const entry = matches[0]!
  const sport = edit.sport ?? entry.sport ?? 'ride'
  if (done.has(entry.id)) return { ok: false, problem: 'That session is done already, so it stays as it is.' }

  if (edit.action === 'move') {
    if (edit.date === entry.date) return { ok: false, problem: "It's on that day already." }
    if (entry.source === 'intervals') warnings.push(FROM_INTERVALS)
    return { ok: true, edit, entry, sport: entry.sport ?? 'ride', warnings }
  }
  if (edit.action === 'remove') {
    if (entry.source === 'intervals') warnings.push(FROM_INTERVALS)
    return { ok: true, edit, entry, sport: entry.sport ?? 'ride', warnings }
  }

  // change
  if (entry.source === 'intervals') return { ok: false, problem: FROM_INTERVALS }
  if (entry.date < today) return { ok: false, problem: "That day has passed, so the session can't be changed." }
  if (!edit.content && sport !== (entry.sport ?? 'ride')) return { ok: false, problem: 'A change of sport needs the new steps, or a duration.' }
  if (entry.planId && edit.content?.kind === 'plain-ride') return { ok: false, problem: 'A ride in a training plan needs steps.' }
  return { ok: true, edit, entry, sport, warnings }
}

/**
 * A session file with its name and notes header lines set (added after the
 * sport line when missing), for a change of only those. Other lines stay.
 */
export function withSessionHeader(file: string, set: { name?: string; notes?: string }): string {
  const lines = file.replace(/\r\n/g, '\n').split('\n')
  let end = lines.findIndex((l) => !l.trim() || !HEADER.test(l.trim()) || l.trim().startsWith('-'))
  if (end < 0) end = lines.length
  const head = lines.slice(0, end)
  const find = (key: string) => head.findIndex((l) => new RegExp(`^\\s*${key}\\s*:`, 'i').test(l))
  for (const key of ['name', 'notes'] as const) {
    const value = set[key]
    if (value === undefined) continue
    const at = find(key)
    if (at >= 0) head[at] = `${key}: ${value}`
    // after the name, else after the sport line
    else head.splice(Math.min(key === 'notes' && find('name') >= 0 ? find('name') + 1 : 1, head.length), 0, `${key}: ${value}`)
  }
  return [...head, ...lines.slice(end)].join('\n')
}
