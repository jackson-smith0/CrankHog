// Training volume for a run of calendar days: what was planned against what
// was done, the way TrainingPeaks sums a week, and split by sport (Ride, Run,
// Swim, Other) the way TrainerRoad shows it. Load is TSS for rides and the
// same scale for other sports (hrTSS, intervals.icu's load, or the rider's),
// so the totals add up.
import { SPORT_GROUPS, type SportGroup } from '../sport/group'
import { dateKey, type DateKey } from './schedule'

export interface VolumeInput {
  today: DateKey
  /** Scheduled sessions, with their length and load where known. A missing sport is a ride. */
  planned: readonly { date: DateKey; durationS: number | null; load: number | null; done: boolean; sport?: SportGroup; distanceM?: number | null }[]
  rides: readonly { startedAt: number; movingS: number; tss: number | null; simulated: boolean; distanceM?: number | null }[]
  /** Everything that isn't a ride recorded or imported into the history: runs, swims, squash, outdoor rides from intervals.icu. */
  activities: readonly { startedAt: number; movingS: number; load: number | null; sport: SportGroup; distanceM?: number | null }[]
}

export interface SportVolume {
  sessions: number
  durationS: number
  distanceM: number
  load: number
}

export interface VolumeSide extends SportVolume {
  /** The same totals for each sport. */
  bySport: Record<SportGroup, SportVolume>
}

export interface VolumeTotals {
  planned: VolumeSide
  completed: VolumeSide
  /** Planned sessions done, out of those due by today; null when none was due yet. */
  compliance: number | null
}

const zero = (): SportVolume => ({ sessions: 0, durationS: 0, distanceM: 0, load: 0 })

function emptySide(): VolumeSide {
  return { ...zero(), bySport: Object.fromEntries(SPORT_GROUPS.map((g) => [g, zero()])) as Record<SportGroup, SportVolume> }
}

function add(side: VolumeSide, sport: SportGroup, durationS: number | null, distanceM: number | null | undefined, load: number | null): void {
  for (const v of [side, side.bySport[sport]]) {
    v.sessions++
    v.durationS += durationS ?? 0
    v.distanceM += distanceM ?? 0
    v.load += load ?? 0
  }
}

/** Volume from `from` to `to`, both days included. */
export function volumeBetween(from: DateKey, to: DateKey, input: VolumeInput): VolumeTotals {
  const inRange = (d: DateKey) => d >= from && d <= to
  const planned = emptySide()
  let due = 0
  let doneDue = 0
  for (const p of input.planned) {
    if (!inRange(p.date)) continue
    add(planned, p.sport ?? 'ride', p.durationS, p.distanceM, p.load)
    if (p.date <= input.today) {
      due++
      if (p.done) doneDue++
    }
  }
  const completed = emptySide()
  for (const r of input.rides) {
    if (r.simulated || !inRange(dateKey(r.startedAt))) continue
    add(completed, 'ride', r.movingS, r.distanceM, r.tss)
  }
  for (const a of input.activities) {
    if (!inRange(dateKey(a.startedAt))) continue
    add(completed, a.sport, a.movingS, a.distanceM, a.load)
  }
  return { planned, completed, compliance: due === 0 ? null : doneDue / due }
}

/** The sports with anything planned or done, in the order Ride, Run, Swim, Other. */
export function sportsIn(v: VolumeTotals): SportGroup[] {
  return SPORT_GROUPS.filter((g) => v.planned.bySport[g].sessions > 0 || v.completed.bySport[g].sessions > 0)
}
