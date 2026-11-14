// The month grid for the History calendar: weeks Monday to Sunday covering
// the whole month, each day with its rides and each week with its totals.
// Local calendar days throughout, so a clock change never moves a ride.
import type { RideSummary } from '@core/ride/types'
import { completions, dateKey as scheduleKey, scheduleStatus, type ScheduleStatus, type ScheduledWorkout } from '@core/workout/schedule'

/** A planned workout on the calendar. Done ones show as their ride instead (see plannedRideIds). */
export interface PlannedOnDay {
  entry: ScheduledWorkout
  status: Exclude<ScheduleStatus, 'done'>
}

export interface CalendarDay {
  /** Local midnight, epoch ms. */
  date: number
  day: number
  inMonth: boolean
  isToday: boolean
  rides: RideSummary[]
  tss: number
  planned: PlannedOnDay[]
  /** Rides that completed a planned workout. */
  plannedRideIds: string[]
}

export interface CalendarWeek {
  days: CalendarDay[]
  rides: number
  movingS: number
  tss: number
}

export interface CalendarMonth {
  year: number
  /** 0-11. */
  month: number
  weeks: CalendarWeek[]
  rides: number
  movingS: number
  tss: number
  /** Workouts planned in the month, done or not. */
  planned: number
}

export const dayKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** The grid for one month, with the rides placed on their local start day. */
export function calendarMonth(year: number, month: number, rides: readonly RideSummary[], now = Date.now(), schedule: readonly ScheduledWorkout[] = []): CalendarMonth {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const weeksCount = Math.ceil((lead + daysInMonth) / 7)
  const byDay = new Map<string, RideSummary[]>()
  for (const r of rides) {
    const k = dayKey(r.startedAt)
    const list = byDay.get(k)
    if (list) list.push(r)
    else byDay.set(k, [r])
  }
  const today = dayKey(now)
  const todayKey = scheduleKey(now)
  const done = completions(schedule, rides.map((r) => ({ id: r.id, startedAt: r.startedAt, workoutId: r.workoutId, simulated: r.simulated })))
  const doneRides = new Set(done.values())
  const plannedByDay = new Map<string, PlannedOnDay[]>()
  for (const e of schedule) {
    if (done.has(e.id)) continue
    const status = scheduleStatus(e, false, todayKey) as PlannedOnDay['status']
    const list = plannedByDay.get(e.date)
    if (list) list.push({ entry: e, status })
    else plannedByDay.set(e.date, [{ entry: e, status }])
  }
  let planned = 0
  const weeks: CalendarWeek[] = []
  let total = { rides: 0, movingS: 0, tss: 0 }
  for (let w = 0; w < weeksCount; w++) {
    const days: CalendarDay[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(year, month, 1 - lead + w * 7 + i)
      const list = (byDay.get(dayKey(d.getTime())) ?? []).slice().sort((a, b) => a.startedAt - b.startedAt)
      const key = scheduleKey(d.getTime())
      const onDay = plannedByDay.get(key) ?? []
      const plannedRideIds = list.filter((r) => doneRides.has(r.id)).map((r) => r.id)
      if (d.getMonth() === month) planned += onDay.length + plannedRideIds.length
      days.push({
        date: d.getTime(),
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: dayKey(d.getTime()) === today,
        rides: list,
        tss: list.reduce((s, r) => s + (r.tss ?? 0), 0),
        planned: onDay,
        plannedRideIds,
      })
    }
    const inWeek = days.flatMap((d) => d.rides)
    weeks.push({ days, rides: inWeek.length, movingS: inWeek.reduce((s, r) => s + r.movingS, 0), tss: inWeek.reduce((s, r) => s + (r.tss ?? 0), 0) })
    const inMonth = days.filter((d) => d.inMonth).flatMap((d) => d.rides)
    total = { rides: total.rides + inMonth.length, movingS: total.movingS + inMonth.reduce((s, r) => s + r.movingS, 0), tss: total.tss + inMonth.reduce((s, r) => s + (r.tss ?? 0), 0) }
  }
  return { year, month, weeks, ...total, planned }
}

/** How strongly to shade a day: 0 (no load) to 3 (a big day), by TSS. */
export function loadBand(tss: number): 0 | 1 | 2 | 3 {
  if (tss <= 0) return 0
  if (tss < 50) return 1
  if (tss < 100) return 2
  return 3
}

/** The month before or after, as [year, month]. */
export function shiftMonth(year: number, month: number, by: number): [number, number] {
  const d = new Date(year, month + by, 1)
  return [d.getFullYear(), d.getMonth()]
}
