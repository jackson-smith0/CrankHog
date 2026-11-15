import { describe, expect, it } from 'vitest'
import { splitMultisport, type DecodedFit } from '../fit/import'
import { groupOfFitSport, groupOfIntervalsType, isSportGroup } from './group'

describe('groupOfFitSport', () => {
  it('puts rides, runs and swims in their groups', () => {
    expect(groupOfFitSport('cycling')).toBe('ride')
    expect(groupOfFitSport('e_biking')).toBe('ride')
    expect(groupOfFitSport('running', 'trail')).toBe('run')
    expect(groupOfFitSport('walking')).toBe('run')
    expect(groupOfFitSport('hiking')).toBe('run')
    expect(groupOfFitSport('swimming', 'lap_swimming')).toBe('swim')
    expect(groupOfFitSport('generic', 'open_water')).toBe('swim')
  })

  it('puts a squash game, a gym session and anything unknown in other', () => {
    expect(groupOfFitSport('racket', 'squash')).toBe('other')
    expect(groupOfFitSport('training', 'strength_training')).toBe('other')
    expect(groupOfFitSport('tennis')).toBe('other')
    expect(groupOfFitSport(null)).toBe('other')
  })

  it('groups the legs of a triathlon file', () => {
    const t0 = Date.UTC(2026, 10, 15, 7) / 1000
    const fit: DecodedFit = {
      sessions: [
        { sport: 'swimming', sub_sport: 'open_water', start_time: new Date(t0 * 1000) },
        { sport: 'transition', start_time: new Date((t0 + 1800) * 1000) },
        { sport: 'cycling', sub_sport: 'road', start_time: new Date((t0 + 1900) * 1000) },
        { sport: 'transition', start_time: new Date((t0 + 5500) * 1000) },
        { sport: 'running', start_time: new Date((t0 + 5600) * 1000) },
      ],
      records: [],
    } as DecodedFit
    const groups = splitMultisport(fit).map((leg) => groupOfFitSport(leg.sessions?.[0]?.sport, leg.sessions?.[0]?.sub_sport))
    expect(groups).toEqual(['swim', 'ride', 'run'])
  })
})

describe('groupOfIntervalsType', () => {
  it('maps intervals.icu types', () => {
    expect(groupOfIntervalsType('VirtualRide')).toBe('ride')
    expect(groupOfIntervalsType('GravelRide')).toBe('ride')
    expect(groupOfIntervalsType('TrailRun')).toBe('run')
    expect(groupOfIntervalsType('OpenWaterSwim')).toBe('swim')
    expect(groupOfIntervalsType('Squash')).toBe('other')
    expect(groupOfIntervalsType('WeightTraining')).toBe('other')
    expect(groupOfIntervalsType(null)).toBe('other')
  })
})

describe('isSportGroup', () => {
  it('knows the four groups and nothing else', () => {
    expect(isSportGroup('swim')).toBe(true)
    expect(isSportGroup('squash')).toBe(false)
    expect(isSportGroup(3)).toBe(false)
  })
})
