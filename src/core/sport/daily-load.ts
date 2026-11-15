// Each day's training load from every sport, for fitness, fatigue and form:
// ride TSS plus the load of runs, swims and everything else, which is on the
// same scale (src/core/sport/load.ts). Simulated rides never count. A day's
// key is its local calendar date, as the calendar and the PMC use.
import type { PmcDay } from '../metrics/pmc'
import { dateKey } from '../workout/schedule'

export interface DailyLoadInput {
  rides: readonly { startedAt: number; tss: number | null; simulated: boolean }[]
  /** Other sports, each with its load (null when unknown, which adds nothing). */
  activities?: readonly { startedAt: number; load: number | null }[]
}

/** One entry per ride and activity, dated by its local day; computePmc sums a day's entries. */
export function dailyLoad({ rides, activities = [] }: DailyLoadInput): PmcDay[] {
  const days: PmcDay[] = []
  for (const r of rides) if (!r.simulated) days.push({ date: dateKey(r.startedAt), tss: r.tss ?? 0 })
  for (const a of activities) days.push({ date: dateKey(a.startedAt), tss: a.load ?? 0 })
  return days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
