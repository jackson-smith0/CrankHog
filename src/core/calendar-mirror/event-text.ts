// What a planned entry says in Google Calendar: its name as the title, and
// a short description with the sport, length and load, then the workout's
// own notes. Plain text, sentence case, no emoji.
import { SPORT_GROUP_LABEL, type SportGroup } from '../sport/group'
import { EFFORT_LABEL, type Effort } from '../sport/load'
import { formatSportDistance } from '../sport/format'
import type { UnitSystem } from '../units'
import type { DateKey } from '../workout/schedule'
import type { MirrorEvent } from './mirror'

/** A planned entry with what the renderer looked up about it (the library workout's length and TSS). */
export interface MirrorSource {
  id: string
  date: DateKey
  name: string
  sport: SportGroup
  /** "Squash", "Long run": a session's own label. */
  label?: string
  durationS?: number | null
  distanceM?: number | null
  tss?: number | null
  /** A session's planned load, when it has no TSS from steps. */
  load?: number | null
  effort?: Effort
  /** The workout's description, or a session's notes. */
  notes?: string
}

export const MIRROR_FOOTER = 'Planned in CrankHog. Move or change it there: this calendar follows CrankHog.'

const TITLE_MAX = 300
const NOTES_MAX = 4000

/** 3600 → "1 h", 4500 → "1 h 15 min", 2700 → "45 min". */
export function plainDuration(s: number): string {
  const m = Math.round(s / 60)
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} min`
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

export function mirrorEvent(src: MirrorSource, units: UnitSystem): MirrorEvent {
  const facts: string[] = [src.label && src.label !== src.name ? `${SPORT_GROUP_LABEL[src.sport]}: ${src.label}` : SPORT_GROUP_LABEL[src.sport]]
  if (src.durationS && src.durationS > 0) facts.push(plainDuration(src.durationS))
  if (src.distanceM && src.distanceM > 0) facts.push(formatSportDistance(src.distanceM, src.sport, units))
  if (src.effort) facts.push(EFFORT_LABEL[src.effort])
  if (src.tss != null && src.tss > 0) facts.push(`TSS ${Math.round(src.tss)}`)
  else if (src.load != null && src.load > 0) facts.push(`Load ${Math.round(src.load)}`)
  const notes = src.notes?.trim().slice(0, NOTES_MAX)
  const description = [facts.join(' · '), notes, MIRROR_FOOTER].filter(Boolean).join('\n\n')
  const title = (src.name.trim() || SPORT_GROUP_LABEL[src.sport]).slice(0, TITLE_MAX)
  return { key: src.id, date: src.date, title, description }
}
