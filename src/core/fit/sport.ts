// Plain names for the FIT sports CrankHog imports besides rides.

const SPORT: Record<string, string> = {
  running: 'Run',
  walking: 'Walk',
  hiking: 'Hike',
  swimming: 'Swim',
  training: 'Strength',
  fitness_equipment: 'Gym',
  rowing: 'Row',
  cross_country_skiing: 'Ski',
  e_biking: 'E-bike ride',
  racket: 'Racket sport',
  tennis: 'Tennis',
}

/** Sub-sports that only name the activity within one sport: "trail" is a trail run when running, but a hike on a trail is still a hike. */
const SUB_SPORT_OF: Record<string, string> = { trail: 'running', open_water: 'swimming' }

/** Sub-sports that name the activity better than its sport does: a FIT squash game is sport "racket". */
const SUB_SPORT: Record<string, string> = {
  squash: 'Squash',
  padel: 'Padel',
  pickleball: 'Pickleball',
  badminton: 'Badminton',
  racquetball: 'Racquetball',
  table_tennis: 'Table tennis',
  strength_training: 'Strength',
  open_water: 'Open water swim',
  trail: 'Trail run',
}

const plain = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')

/** "running" → "Run"; "racket" with sub-sport "squash" → "Squash"; an unknown FIT sport reads as itself ("kayaking" → "Kayaking"). */
export function sportLabel(sport: string, subSport?: string | null): string {
  if (subSport && SUB_SPORT[subSport] && (!SUB_SPORT_OF[subSport] || SUB_SPORT_OF[subSport] === sport)) return SUB_SPORT[subSport]
  return SPORT[sport] ?? plain(sport)
}

/** "Morning run", "Evening squash": by the local time it started. */
export function activityName(sport: string, startedAt: number, subSport?: string | null): string {
  const h = new Date(startedAt).getHours()
  const part = h < 5 ? 'Night' : h < 11 ? 'Morning' : h < 14 ? 'Lunch' : h < 18 ? 'Afternoon' : 'Evening'
  return `${part} ${sportLabel(sport, subSport).toLowerCase()}`
}
