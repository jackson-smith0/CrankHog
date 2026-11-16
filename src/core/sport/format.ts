// Distances the way each sport talks about them: a swim in metres or yards,
// a run or a ride in kilometres or miles.
import { formatLongDistance, type UnitSystem } from '../units'
import type { SportGroup } from './group'

const M_PER_YD = 0.9144

/** "2,000 m" or "2,187 yd" for a swim; "8.2 km" or "5.1 mi" for anything else. */
export function formatSportDistance(m: number, sport: SportGroup, units: UnitSystem): string {
  if (sport === 'swim') {
    const v = units === 'imperial' ? Math.round(m / M_PER_YD) : Math.round(m)
    return `${v.toLocaleString('en-US')} ${units === 'imperial' ? 'yd' : 'm'}`
  }
  return `${formatLongDistance(m, units, 1)} ${units === 'imperial' ? 'mi' : 'km'}`
}

/** A swim's volume in metres, whatever the rider's units: "1,800 m". Swims are planned by distance, often with no time at all. */
export function formatSwimMetres(m: number): string {
  return `${Math.round(m).toLocaleString('en-US')} m`
}
