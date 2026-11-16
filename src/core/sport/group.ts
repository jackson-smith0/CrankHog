// The four sports weekly volume is split into, the way TrainerRoad and
// TrainingPeaks sum a week: Ride, Run, Swim, and everything else (a squash
// game, a gym session, a hike). A FIT file names its sport one way and
// intervals.icu another; both map onto these four.

export type SportGroup = 'ride' | 'run' | 'swim' | 'other'

export const SPORT_GROUPS: readonly SportGroup[] = ['ride', 'run', 'swim', 'other']

export const SPORT_GROUP_LABEL: Record<SportGroup, string> = {
  ride: 'Ride',
  run: 'Run',
  swim: 'Swim',
  other: 'Other',
}

export const isSportGroup = (s: unknown): s is SportGroup => typeof s === 'string' && (SPORT_GROUPS as readonly string[]).includes(s)

const FIT_RIDE = new Set(['cycling', 'e_biking'])
const FIT_RUN = new Set(['running', 'walking', 'hiking'])
const FIT_SWIM = new Set(['swimming'])
const FIT_SWIM_SUB = new Set(['lap_swimming', 'open_water'])

/** A FIT session's sport ("running", sub-sport "trail") as one of the four. */
export function groupOfFitSport(sport: string | null | undefined, subSport?: string | null): SportGroup {
  const s = (sport ?? '').toLowerCase()
  if (FIT_RIDE.has(s)) return 'ride'
  if (FIT_RUN.has(s)) return 'run'
  if (FIT_SWIM.has(s) || (subSport && FIT_SWIM_SUB.has(subSport))) return 'swim'
  return 'other'
}

const ICU_RIDE = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'EMountainBikeRide', 'TrackRide', 'Velomobile', 'Handcycle'])
const ICU_RUN = new Set(['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'])
const ICU_SWIM = new Set(['Swim', 'OpenWaterSwim'])

/** An intervals.icu activity or event type ("TrailRun") as one of the four. */
export function groupOfIntervalsType(type: string | null | undefined): SportGroup {
  const t = type ?? ''
  if (ICU_RIDE.has(t)) return 'ride'
  if (ICU_RUN.has(t)) return 'run'
  if (ICU_SWIM.has(t)) return 'swim'
  return 'other'
}

/** The intervals.icu type a planned session is sent as. */
export const INTERVALS_TYPE: Record<SportGroup, string> = {
  ride: 'Ride',
  run: 'Run',
  swim: 'Swim',
  other: 'Workout',
}

/** An activity's group: the one stored with it, else worked out from its FIT sport. */
export function activityGroup(a: { group?: SportGroup | null; sport: string; subSport?: string | null }): SportGroup {
  return a.group ?? groupOfFitSport(a.sport, a.subSport)
}
