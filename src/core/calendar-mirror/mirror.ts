// The rider's planned training, mirrored into a Google calendar CrankHog
// owns. CrankHog's calendar is the truth: each sync sends every planned
// entry from the window on, and main makes the Google calendar match it,
// whatever happened in between (moves, renames, removals, a plan re-laid,
// changes made offline). No log of changes is kept, so none can be lost.
//
// Days are local calendar dates ("2026-11-18") and the events are all-day,
// so a session stays on its day across time zones.
import { addDays, type DateKey } from '../workout/schedule'

/** One planned entry as an all-day event. `key` is the calendar entry's id. */
export interface MirrorEvent {
  key: string
  date: DateKey
  title: string
  description: string
}

/** An event found in the mirrored calendar: one CrankHog put there carries its entry's key and fingerprint. */
export interface MirroredEvent {
  eventId: string
  date: DateKey
  key: string | null
  fingerprint: string | null
}

export interface MirrorDiff {
  insert: MirrorEvent[]
  update: { eventId: string; event: MirrorEvent }[]
  delete: string[]
}

/** How far back the mirror reaches: older events are left as they are, so the past isn't rewritten. */
export const MIRROR_PAST_DAYS = 30

export function mirrorWindowStart(today: DateKey): DateKey {
  return addDays(today, -MIRROR_PAST_DAYS)
}

/**
 * The event id CrankHog asks Google for, from the entry's key. Google takes
 * 5 to 1024 characters of base32hex (a-v, 0-9); each UTF-16 unit as four hex
 * digits stays inside that, and the same entry always gets the same id, so a
 * retried insert can't make a duplicate.
 */
export function googleEventId(key: string): string {
  let hex = ''
  for (let i = 0; i < key.length; i++) hex += key.charCodeAt(i).toString(16).padStart(4, '0')
  return `ch${hex}`
}

/** A short hash of what the event shows (FNV-1a), stored with it so an unchanged event costs nothing. */
export function fingerprint(e: MirrorEvent): string {
  const s = `${e.date}\u0000${e.title}\u0000${e.description}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** The exclusive end day of an all-day event on `date`. */
export const allDayEnd = (date: DateKey): DateKey => addDays(date, 1)

/**
 * What to change in the mirrored calendar so it shows `desired`.
 * - Only events CrankHog put there (they carry a key) are touched, so
 *   anything the rider adds to the calendar themselves stays.
 * - Events before `windowStart` are left alone, and so are desired entries
 *   before it.
 * - An event is rewritten when its fingerprint differs, or when its day does
 *   (it was dragged in Google): CrankHog's day wins.
 * - A second event for the same key is a leftover, and goes.
 */
export function diffMirror(desired: readonly MirrorEvent[], actual: readonly MirroredEvent[], windowStart: DateKey): MirrorDiff {
  const out: MirrorDiff = { insert: [], update: [], delete: [] }
  const ours = new Map<string, MirroredEvent>()
  for (const a of actual) {
    if (a.key === null || a.date < windowStart) continue
    if (ours.has(a.key)) out.delete.push(a.eventId)
    else ours.set(a.key, a)
  }
  const wanted = new Set<string>()
  for (const e of desired) {
    if (e.date < windowStart || wanted.has(e.key)) continue
    wanted.add(e.key)
    const have = ours.get(e.key)
    if (!have) out.insert.push(e)
    else if (have.fingerprint !== fingerprint(e) || have.date !== e.date) out.update.push({ eventId: have.eventId, event: e })
  }
  for (const [key, a] of ours) if (!wanted.has(key)) out.delete.push(a.eventId)
  return out
}
