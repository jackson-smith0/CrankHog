// Training plans: a named, ordered list of workouts plus the weekdays the
// rider rides and a start date. Laying a plan out turns it into calendar days:
// workouts with a date of their own (from a "YYYY-MM-DD_" file name) keep it,
// and the rest fill the ride days in order.
import { addDays, dateKeyToMs, isDateKey, type DateKey } from './schedule'

export interface PlanItem {
  /** Stable within the plan, so its calendar entry can be found again after a reorder. */
  id: string
  workoutId: string
  /** A fixed day, from a date-prefixed file name. Otherwise the plan's ride days decide. */
  date?: DateKey
}

export type PlanGoal = 'ftp' | 'endurance' | 'event'
export type EventFocus = 'general' | 'climbing' | 'time-trial' | 'criterium'

/** The answers to "Build a plan for me". */
export interface PlanSurvey {
  hoursPerWeek: number
  /** Weekdays the rider can ride, 0 = Monday … 6 = Sunday. */
  rideDays: number[]
  /** The weekday for the long ride, if any. */
  longDay: number | null
  goal: PlanGoal
  focus: EventFocus
  startDate: DateKey
}

export interface TrainingPlan {
  id: string
  name: string
  description?: string
  items: PlanItem[]
  /** 0 = Monday … 6 = Sunday. */
  rideDays: number[]
  startDate: DateKey
  /** Laid out on the calendar; edits re-lay it. */
  onCalendar: boolean
  /** The event the plan builds to (a calendar day). */
  eventId?: string
  survey?: PlanSurvey
  source: 'files' | 'ai' | 'builtin' | 'manual'
  createdAt: number
  updatedAt: number
}

/** An event, or a day off, on the calendar. Plans skip rest, sick and travel days. */
export interface DayMark {
  id: string
  date: DateKey
  kind: 'event' | 'rest' | 'sick' | 'travel'
  /** Events: "Gran fondo". */
  name?: string
  /** Events: A is the one the plan builds to. */
  priority?: 'A' | 'B' | 'C'
  note?: string
}

export const isBlocking = (m: Pick<DayMark, 'kind'>): boolean => m.kind !== 'event'

export interface LayoutInput {
  items: readonly Pick<PlanItem, 'workoutId' | 'date'>[]
  rideDays: readonly number[]
  startDate: DateKey
  today: DateKey
  /** Rest, sick and travel days: no undated workout goes there. */
  blocked?: ReadonlySet<DateKey>
  /** The event day: undated workouts stop the day before it. */
  endDate?: DateKey
}

export interface Placement {
  date: DateKey
  workoutId: string
  /** The item's place in the plan. */
  index: number
}

export type PlanWarning = { kind: 'no-ride-days' } | { kind: 'past-event'; count: number } | { kind: 'before-today'; count: number }

export interface Layout {
  placements: Placement[]
  /** Items that found no day (no ride days, or the event came first). */
  unplaced: number[]
  warnings: PlanWarning[]
}

/** A plan never runs longer than this, so a bad input can't loop for ever. */
const MAX_PLAN_DAYS = 3 * 366

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(key: DateKey): number {
  return (new Date(dateKeyToMs(key)).getDay() + 6) % 7
}

export function layOutPlan(input: LayoutInput): Layout {
  const placements: Placement[] = []
  const unplaced: number[] = []
  const warnings: PlanWarning[] = []
  const taken = new Set<DateKey>()
  input.items.forEach((item, index) => {
    if (item.date) {
      placements.push({ date: item.date, workoutId: item.workoutId, index })
      taken.add(item.date)
    }
  })
  const rideDays = new Set(input.rideDays)
  const undated = input.items.map((item, index) => ({ item, index })).filter(({ item }) => !item.date)
  if (undated.length > 0 && rideDays.size === 0) {
    warnings.push({ kind: 'no-ride-days' })
    unplaced.push(...undated.map(({ index }) => index))
  } else {
    let day = input.startDate
    let next = 0
    for (let n = 0; n < MAX_PLAN_DAYS && next < undated.length; n++, day = addDays(day, 1)) {
      if (input.endDate && day >= input.endDate) break
      if (!rideDays.has(weekdayOf(day)) || taken.has(day) || input.blocked?.has(day)) continue
      const { item, index } = undated[next++]!
      placements.push({ date: day, workoutId: item.workoutId, index })
    }
    const left = undated.slice(next).map(({ index }) => index)
    if (left.length > 0) {
      unplaced.push(...left)
      warnings.push({ kind: 'past-event', count: left.length })
    }
  }
  placements.sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)
  const early = placements.filter((p) => p.date < input.today).length
  if (early > 0) warnings.push({ kind: 'before-today', count: early })
  return { placements, unplaced: unplaced.sort((a, b) => a - b), warnings }
}

const DATED = /^(\d{4}-\d{2}-\d{2})_(.+)$/

/**
 * "2026-11-18_Threshold 2x20.zwo" → { date: "2026-11-18", rest: "Threshold 2x20" }.
 * The extension always goes; the date only when it is a real day.
 */
export function parseDatedFileName(fileName: string): { date: DateKey | null; rest: string } {
  const base = fileName.replace(/\.[^.]+$/, '')
  const m = DATED.exec(base)
  if (!m || !isRealDay(m[1]!)) return { date: null, rest: base }
  return { date: m[1]!, rest: m[2]! }
}

function isRealDay(key: string): boolean {
  if (!isDateKey(key)) return false
  const [y, mo, d] = key.split('-').map(Number) as [number, number, number]
  const date = new Date(y, mo - 1, d)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
}
