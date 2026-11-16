import { describe, expect, it } from 'vitest'
import { sportsIn, volumeBetween, type VolumeInput } from './volume'

const at = (y: number, m: number, d: number, h = 18) => new Date(y, m - 1, d, h).getTime()

const input: VolumeInput = {
  today: '2026-11-18',
  planned: [
    { date: '2026-11-16', durationS: 3600, load: 60, done: true },
    { date: '2026-11-17', durationS: 2700, load: 50, done: false, sport: 'run', distanceM: 8000 },
    { date: '2026-11-19', durationS: 5400, load: 80, done: false },
    { date: '2026-11-19', durationS: null, load: null, done: false, sport: 'other' },
  ],
  rides: [
    { startedAt: at(2026, 11, 16), movingS: 3700, tss: 62, simulated: false, distanceM: 30_000 },
    { startedAt: at(2026, 11, 18), movingS: 1800, tss: null, simulated: false },
    { startedAt: at(2026, 11, 18, 7), movingS: 9999, tss: 999, simulated: true },
    { startedAt: at(2026, 11, 23), movingS: 3600, tss: 50, simulated: false },
  ],
  activities: [
    { startedAt: at(2026, 11, 17), movingS: 2400, load: 35.5, sport: 'run', distanceM: 7000 },
    { startedAt: at(2026, 11, 18, 20), movingS: 3600, load: 70, sport: 'other' },
  ],
}

describe('volumeBetween', () => {
  it('adds up planned and completed time, distance, load and sessions for the days asked', () => {
    const v = volumeBetween('2026-11-16', '2026-11-22', input)
    expect(v.planned).toMatchObject({ sessions: 4, durationS: 3600 + 2700 + 5400, distanceM: 8000, load: 60 + 50 + 80 })
    expect(v.completed).toMatchObject({ sessions: 4, durationS: 3700 + 1800 + 2400 + 3600, distanceM: 37_000, load: 62 + 35.5 + 70 })
    // two planned sessions were due by today, and one was done
    expect(v.compliance).toBe(0.5)
  })

  it('splits each side by sport, and a planned entry without a sport is a ride', () => {
    const v = volumeBetween('2026-11-16', '2026-11-22', input)
    expect(v.planned.bySport.ride).toEqual({ sessions: 2, durationS: 9000, distanceM: 0, load: 140 })
    expect(v.planned.bySport.run).toEqual({ sessions: 1, durationS: 2700, distanceM: 8000, load: 50 })
    expect(v.planned.bySport.other).toEqual({ sessions: 1, durationS: 0, distanceM: 0, load: 0 })
    expect(v.completed.bySport.ride).toEqual({ sessions: 2, durationS: 5500, distanceM: 30_000, load: 62 })
    expect(v.completed.bySport.run).toEqual({ sessions: 1, durationS: 2400, distanceM: 7000, load: 35.5 })
    expect(v.completed.bySport.other).toEqual({ sessions: 1, durationS: 3600, distanceM: 0, load: 70 })
    expect(v.completed.bySport.swim.sessions).toBe(0)
    expect(sportsIn(v)).toEqual(['ride', 'run', 'other'])
  })

  it('has no compliance before anything planned is due', () => {
    expect(volumeBetween('2026-11-19', '2026-11-22', input).compliance).toBeNull()
  })

  it('counts nothing outside the range, and never a simulated ride', () => {
    const v = volumeBetween('2026-11-23', '2026-11-29', input)
    expect(v.completed).toMatchObject({ sessions: 1, durationS: 3600, load: 50 })
    expect(v.planned).toMatchObject({ sessions: 0, durationS: 0, load: 0 })
    expect(sportsIn(v)).toEqual(['ride'])
  })
})
