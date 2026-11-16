// The training load of one session from any sport, on the same scale as
// ride TSS (an hour at threshold is 100), so a week's load and fitness add up
// across sports.

/** How hard a session felt, for ones entered by hand or planned without steps. */
export type Effort = 'easy' | 'moderate' | 'hard' | 'max'

export const EFFORTS: readonly Effort[] = ['easy', 'moderate', 'hard', 'max']

export const EFFORT_LABEL: Record<Effort, string> = { easy: 'Easy', moderate: 'Moderate', hard: 'Hard', max: 'All out' }

/** TSS an hour at each effort: an easy hour is about 40, an hour at threshold 100. */
export const EFFORT_TSS_PER_HOUR: Record<Effort, number> = { easy: 40, moderate: 60, hard: 80, max: 100 }

export const isEffort = (s: unknown): s is Effort => typeof s === 'string' && (EFFORTS as readonly string[]).includes(s)

/** Load from how long and how hard. Null without a length: missing is not zero. */
export function effortLoad(durationS: number | null | undefined, effort: Effort | null | undefined): number | null {
  if (!effort || durationS === null || durationS === undefined || !(durationS > 0)) return null
  return Math.round((durationS / 3600) * EFFORT_TSS_PER_HOUR[effort] * 10) / 10
}

/** Where an activity's load can come from, best first. */
export interface ActivityLoadSources {
  /** hrTSS CrankHog worked out from the heart rate in a FIT file. */
  hrLoad?: number | null
  /** intervals.icu's training load (TSS from power, else from heart rate or pace). */
  icuLoad?: number | null
  /** Typed in by the rider, or worked out from the effort they picked. */
  manualLoad?: number | null
}

const usable = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The activity's load: its own heart-rate score, else intervals.icu's, else the rider's. Null when none is known. */
export function activityLoad(a: ActivityLoadSources): number | null {
  if (usable(a.hrLoad)) return a.hrLoad
  if (usable(a.icuLoad)) return a.icuLoad
  if (usable(a.manualLoad)) return a.manualLoad
  return null
}
