// The time and distance fields of a session typed in by hand: "45", "1:15",
// "1h15m" for time; "8", "8 km", "5 mi", "1500" (a swim, in metres) for
// distance. A bare number means minutes, and kilometres or miles (metres or
// yards for a swim) in the rider's units.
import type { UnitSystem } from '../units'
import type { SportGroup } from './group'

const M_PER_MI = 1609.344
const M_PER_YD = 0.9144

/** Seconds from "45" (minutes), "1:15" (hours:minutes), "45m", "1h15m", "90min". Null when it isn't a time. */
export function parseTimeField(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  let m = /^(\d+(?:\.\d+)?)$/.exec(t)
  if (m) return positive(Number(m[1]) * 60)
  m = /^(\d+):([0-5]\d)$/.exec(t)
  if (m) return positive(Number(m[1]) * 3600 + Number(m[2]) * 60)
  m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)(?:m|min|mins))?(?:(\d+)s)?$/.exec(t)
  if (m && (m[1] ?? m[2] ?? m[3]) !== undefined) return positive(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0))
  return null
}

/** Metres from a distance field. A bare number is km or mi, or metres or yards for a swim. Null when it isn't a distance. */
export function parseDistanceField(text: string, sport: SportGroup, units: UnitSystem): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '')
  if (!t) return null
  const m = /^(\d+(?:\.\d+)?)(km|mi|m|mtr|y|yd|yds)?$/.exec(t)
  if (!m) return null
  const v = Number(m[1])
  switch (m[2]) {
    case 'km':
      return positive(v * 1000)
    case 'mi':
      return positive(v * M_PER_MI)
    case 'm':
    case 'mtr':
      return positive(v)
    case 'y':
    case 'yd':
    case 'yds':
      return positive(v * M_PER_YD)
    default:
      if (sport === 'swim') return positive(units === 'imperial' ? v * M_PER_YD : v)
      return positive(units === 'imperial' ? v * M_PER_MI : v * 1000)
  }
}

/** What a bare number in the distance field means, for its placeholder: "km", "mi", "m" or "yd". */
export function distanceFieldUnit(sport: SportGroup, units: UnitSystem): 'km' | 'mi' | 'm' | 'yd' {
  if (sport === 'swim') return units === 'imperial' ? 'yd' : 'm'
  return units === 'imperial' ? 'mi' : 'km'
}

const positive = (v: number): number | null => (Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null)
