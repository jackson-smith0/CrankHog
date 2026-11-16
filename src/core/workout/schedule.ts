// Workouts scheduled on calendar days: what is planned, what was ridden, and
// what was missed. A scheduled workout is done when a real (not simulated)
// ride of that workout starts on its day; nothing has to be ticked off. A
// planned session of another sport (a run, a swim, a squash game) is done
// when an activity of that sport starts on its day.
//
// Days are local calendar dates ("2026-11-14"), never instants, so a plan
// stays on its day across clock changes and when travelling.
import { groupOfIntervalsType, type SportGroup } from '../sport/group'
import type { Effort } from '../sport/load'
import type { Workout } from './model'
import { parseIntervalsText } from './io/intervals-text'
import { parseZwo } from './io/zwo'

/** A local calendar day, "YYYY-MM-DD". */
export type DateKey = string

export interface ScheduledWorkout {
  id: string
  date: DateKey
  /** A workout in the library (built-in or the rider's own)… */
  workoutId: string | null
  /** …or the workout itself, for one imported from a calendar elsewhere. */
  workout: Workout | null
  /** Shown on the calendar, so it reads right even if the library workout is renamed or deleted. */
  name: string
  source: 'manual' | 'intervals'
  /** The intervals.icu event id, for workouts imported from there. */
  externalId?: string
  /** The training plan that put it here, and which of its items. */
  planId?: string
  planItemId?: string
  /** The sport. Missing means a ride (every entry before multisport was one). */
  sport?: SportGroup
  /** A session that isn't a bike workout: a run, a swim, a squash game, or a ride planned without steps. */
  session?: PlannedSession
  /** The intervals.icu event CrankHog sent this session as, so a move or removal can follow it there. */
  pushedEventId?: string
  createdAt: number
}

/** What is planned for a session with no bike workout: its length, how hard, and maybe its steps. */
export interface PlannedSession {
  /** "Squash", "Long run": shown with the sport. */
  label?: string
  durationS?: number | null
  distanceM?: number | null
  effort?: Effort
  /** Planned load, when the rider gave one or the steps give one. */
  load?: number | null
  notes?: string
  /** A run or swim workout in the library (src/core/multisport). */
  sessionWorkoutId?: string
  /** The session's steps in intervals.icu text, for one imported or pasted without a library copy. */
  text?: string
}

/** The entry's sport: a ride unless it says otherwise. */
export const entrySport = (e: Pick<ScheduledWorkout, 'sport'>): SportGroup => e.sport ?? 'ride'

/** A bike workout CrankHog can play, as opposed to a session done elsewhere. */
export const isBikeWorkout = (e: Pick<ScheduledWorkout, 'workoutId' | 'workout' | 'sport'>): boolean => entrySport(e) === 'ride' && (e.workoutId !== null || e.workout !== null)

export type ScheduleStatus = 'planned' | 'today' | 'done' | 'missed'

/** What scheduling needs to know about a recorded ride. */
export interface ScheduleRide {
  id: string
  startedAt: number
  workoutId?: string
  simulated: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/** The local calendar day of an instant. */
export function dateKey(ms: number): DateKey {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local midnight at the start of a day. */
export function dateKeyToMs(key: DateKey): number {
  const m = DATE_KEY.exec(key)
  if (!m) throw new Error(`Not a date: ${key}`)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

export function isDateKey(s: string): s is DateKey {
  return DATE_KEY.test(s)
}

/** The day `n` days after `key` (before, for negative n). */
export function addDays(key: DateKey, n: number): DateKey {
  const d = new Date(dateKeyToMs(key))
  d.setDate(d.getDate() + n)
  return dateKey(d.getTime())
}

/** The workout an entry plays: its library id, or the id of the workout it carries. */
export const plannedWorkoutId = (e: ScheduledWorkout): string | null => e.workoutId ?? e.workout?.id ?? null

/** What scheduling needs to know about an activity that isn't a ride in the history. */
export interface ScheduleActivity {
  id: string
  startedAt: number
  group: SportGroup
}

/**
 * Which ride or activity completed each scheduled entry, by id.
 * - A bike workout is done by a real ride of the same workout on the same day.
 * - Any other session is done by an activity of its sport on its day; a ride
 *   planned without a workout is also done by any real ride that day.
 * One ride or activity completes one entry, earliest planned first, and bike
 * workouts claim their rides before sessions do.
 */
export function completions(entries: readonly ScheduledWorkout[], rides: readonly ScheduleRide[], activities: readonly ScheduleActivity[] = []): Map<string, string> {
  const byDayAndWorkout = new Map<string, ScheduleRide[]>()
  const ridesByDay = new Map<string, ScheduleRide[]>()
  for (const r of rides) {
    if (r.simulated) continue
    push(ridesByDay, dateKey(r.startedAt), r)
    if (r.workoutId) push(byDayAndWorkout, `${dateKey(r.startedAt)}|${r.workoutId}`, r)
  }
  const activitiesByDay = new Map<string, ScheduleActivity[]>()
  for (const a of activities) push(activitiesByDay, `${dateKey(a.startedAt)}|${a.group}`, a)
  for (const list of [...byDayAndWorkout.values(), ...ridesByDay.values(), ...activitiesByDay.values()]) list.sort((a, b) => a.startedAt - b.startedAt)

  const done = new Map<string, string>()
  const used = new Set<string>()
  const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const take = <T extends { id: string }>(list: T[] | undefined): T | undefined => {
    const hit = list?.find((x) => !used.has(x.id))
    if (hit) used.add(hit.id)
    return hit
  }
  for (const e of ordered) {
    if (!isBikeWorkout(e)) continue
    const w = plannedWorkoutId(e)
    const ride = w ? take(byDayAndWorkout.get(`${e.date}|${w}`)) : undefined
    if (ride) done.set(e.id, ride.id)
  }
  for (const e of ordered) {
    if (isBikeWorkout(e)) continue
    const sport = entrySport(e)
    const hit = take(activitiesByDay.get(`${e.date}|${sport}`)) ?? (sport === 'ride' ? take(ridesByDay.get(e.date)) : undefined)
    if (hit) done.set(e.id, hit.id)
  }
  return done
}

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

export function scheduleStatus(e: ScheduledWorkout, done: boolean, today: DateKey): ScheduleStatus {
  if (done) return 'done'
  if (e.date === today) return 'today'
  return e.date > today ? 'planned' : 'missed'
}

/** The first of today's workouts not ridden yet, or null. */
export function todaysWorkout(entries: readonly ScheduledWorkout[], rides: readonly ScheduleRide[], now: number, activities: readonly ScheduleActivity[] = []): ScheduledWorkout | null {
  const today = dateKey(now)
  const done = completions(entries, rides, activities)
  return (
    entries
      .filter((e) => e.date === today && !done.has(e.id))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0] ?? null
  )
}

/** A planned workout from intervals.icu's calendar, as main passes it on. */
export interface IntervalsPlannedEvent {
  id: number | string
  /** "2026-11-18T00:00:00", local to the athlete. */
  start_date_local: string
  name?: string
  /** "Ride", "VirtualRide", "Run"… */
  type?: string
  /** The workout in intervals.icu's text format. */
  description?: string
  /** The workout as a Zwift file, when intervals.icu could make one. */
  zwo?: string | null
  /** "freegaz-plan-…" for a session CrankHog sent there itself. */
  external_id?: string | null
  /** Planned seconds and load, as intervals.icu works them out. */
  moving_time?: number | null
  icu_training_load?: number | null
}

export type IntervalsImport = { kind: 'ok'; entry: ScheduledWorkout } | { kind: 'skip'; reason: 'sent from CrankHog' | 'no date' | 'no workout steps' }

/** The external id CrankHog sends a planned session to intervals.icu under. */
export const pushedExternalId = (entryId: string): string => `freegaz-plan-${entryId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)}`

const RIDE_TYPES = new Set(['Ride', 'VirtualRide'])

/**
 * One intervals.icu calendar event as a scheduled workout carrying its own
 * workout. The Zwift file is preferred (intervals.icu writes it from the
 * structured workout); the text description is the fallback.
 */
export function fromIntervalsEvent(ev: IntervalsPlannedEvent, now: number): IntervalsImport {
  // a session CrankHog sent there is already on this calendar
  if (ev.external_id?.startsWith('freegaz-plan-')) return { kind: 'skip', reason: 'sent from CrankHog' }
  const date = ev.start_date_local.slice(0, 10)
  if (!isDateKey(date)) return { kind: 'skip', reason: 'no date' }
  const id = `intervals:${ev.id}`
  const name = ev.name?.trim() || 'intervals.icu workout'
  if (ev.type && !RIDE_TYPES.has(ev.type)) {
    // a run, swim or anything else: a planned session with its steps as text
    const sport = groupOfIntervalsType(ev.type)
    const session: PlannedSession = {
      ...(ev.description?.trim() ? { text: ev.description.trim() } : {}),
      ...(ev.moving_time ? { durationS: ev.moving_time } : {}),
      ...(ev.icu_training_load !== null && ev.icu_training_load !== undefined ? { load: ev.icu_training_load } : {}),
    }
    return { kind: 'ok', entry: { id, date, workoutId: null, workout: null, name, source: 'intervals', externalId: String(ev.id), sport, session, createdAt: now } }
  }
  let workout: Workout | null = null
  if (ev.zwo) {
    try {
      workout = parseZwo(ev.zwo, { source: 'import', newId: () => id })
    } catch {
      workout = null
    }
  }
  if ((!workout || workout.segments.length === 0) && ev.description) {
    workout = parseIntervalsText(ev.description, { id, name, source: 'import' }).workout
  }
  if (!workout || workout.segments.length === 0) return { kind: 'skip', reason: 'no workout steps' }
  workout = { ...workout, id, name, source: 'import' }
  return { kind: 'ok', entry: { id, date, workoutId: null, workout, name, source: 'intervals', externalId: String(ev.id), createdAt: now } }
}

/** What a sent session needs on intervals.icu after a change here: moved to another day, or gone. */
export interface PushedChanges {
  moved: { entryId: string; eventId: string; date: DateKey }[]
  removed: { eventId: string }[]
}

/** Compares a day's sent sessions before and after a change (a move, a removal, a plan re-laid). */
export function pushedChanges(before: readonly Pick<ScheduledWorkout, 'id' | 'date' | 'pushedEventId'>[], after: readonly Pick<ScheduledWorkout, 'id' | 'date'>[]): PushedChanges {
  const now = new Map(after.map((e) => [e.id, e.date]))
  const out: PushedChanges = { moved: [], removed: [] }
  for (const e of before) {
    if (!e.pushedEventId) continue
    const date = now.get(e.id)
    if (date === undefined) out.removed.push({ eventId: e.pushedEventId })
    else if (date !== e.date) out.moved.push({ entryId: e.id, eventId: e.pushedEventId, date })
  }
  return out
}
