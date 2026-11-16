import { describe, expect, it } from 'vitest'
import { formatSportDistance } from './format'

describe('formatSportDistance', () => {
  it('gives a swim in metres or yards', () => {
    expect(formatSportDistance(2000, 'swim', 'metric')).toBe('2,000 m')
    expect(formatSportDistance(1508.76, 'swim', 'imperial')).toBe('1,650 yd')
  })

  it('gives a run or a ride in kilometres or miles', () => {
    expect(formatSportDistance(8200, 'run', 'metric')).toBe('8.2 km')
    expect(formatSportDistance(16093.44, 'ride', 'imperial')).toBe('10 mi')
  })
})
