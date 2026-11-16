import { describe, expect, it } from 'vitest'
import { activityName, sportLabel } from './sport'

describe('sportLabel', () => {
  it('names a squash game by its sub-sport, not as a racket sport', () => {
    expect(sportLabel('racket', 'squash')).toBe('Squash')
    expect(sportLabel('racket')).toBe('Racket sport')
  })

  it('names a trail run by its sub-sport, but not a hike on a trail', () => {
    expect(sportLabel('running', 'trail')).toBe('Trail run')
    expect(sportLabel('hiking', 'trail')).toBe('Hike')
    expect(sportLabel('swimming', 'open_water')).toBe('Open water swim')
  })

  it('reads known and unknown sports plainly', () => {
    expect(sportLabel('running')).toBe('Run')
    expect(sportLabel('kayaking')).toBe('Kayaking')
    expect(sportLabel('stand_up_paddleboarding')).toBe('Stand up paddleboarding')
  })
})

describe('activityName', () => {
  it('names an activity by the time of day it started', () => {
    expect(activityName('racket', new Date(2026, 10, 18, 19).getTime(), 'squash')).toBe('Evening squash')
    expect(activityName('running', new Date(2026, 10, 18, 7).getTime())).toBe('Morning run')
  })
})
