import { describe, expect, it } from 'vitest'
import { distanceFieldUnit, parseDistanceField, parseTimeField } from './session-input'

describe('parseTimeField', () => {
  it('reads a bare number as minutes and h:mm as hours and minutes', () => {
    expect(parseTimeField('45')).toBe(2700)
    expect(parseTimeField('1:15')).toBe(4500)
    expect(parseTimeField('0:50')).toBe(3000)
  })

  it('reads written-out times', () => {
    expect(parseTimeField('45m')).toBe(2700)
    expect(parseTimeField('1h')).toBe(3600)
    expect(parseTimeField('1h 15m')).toBe(4500)
    expect(parseTimeField('90min')).toBe(5400)
  })

  it('is null for anything that is not a time', () => {
    for (const t of ['', 'soon', '1:75', '0', '-5']) expect(parseTimeField(t)).toBeNull()
  })
})

describe('parseDistanceField', () => {
  it('reads a bare number in the rider’s units, metres or yards for a swim', () => {
    expect(parseDistanceField('8', 'run', 'metric')).toBe(8000)
    expect(parseDistanceField('5', 'run', 'imperial')).toBe(8046.7)
    expect(parseDistanceField('1500', 'swim', 'metric')).toBe(1500)
    expect(parseDistanceField('1650', 'swim', 'imperial')).toBe(1508.8)
  })

  it('takes a unit when one is given', () => {
    expect(parseDistanceField('8 km', 'run', 'imperial')).toBe(8000)
    expect(parseDistanceField('2,000m', 'swim', 'imperial')).toBe(2000)
    expect(parseDistanceField('400mtr', 'run', 'metric')).toBe(400)
    expect(parseDistanceField('100 yd', 'swim', 'metric')).toBe(91.4)
  })

  it('is null for anything that is not a distance', () => {
    for (const t of ['', 'far', '0', '5 furlongs']) expect(parseDistanceField(t, 'run', 'metric')).toBeNull()
  })

  it('names the unit a bare number means', () => {
    expect(distanceFieldUnit('swim', 'imperial')).toBe('yd')
    expect(distanceFieldUnit('run', 'metric')).toBe('km')
  })
})

describe('paces', () => {
  it('reads and writes minutes:seconds', async () => {
    const { formatPace, parsePaceField } = await import('./session-input')
    expect(parsePaceField('4:15')).toBe(255)
    expect(parsePaceField(' 1:40 ')).toBe(100)
    expect(parsePaceField('4:75')).toBeNull()
    expect(parsePaceField('fast')).toBeNull()
    expect(formatPace(255)).toBe('4:15')
    expect(formatPace(99.6)).toBe('1:40')
  })

  it('shows run pace per mile and swim pace per 100 yd in imperial, stored per km and per 100 m', async () => {
    const { runPaceShown, runPaceStored, swimPaceShown, swimPaceStored } = await import('./session-input')
    expect(Math.round(runPaceShown(255, 'imperial'))).toBe(410)
    expect(runPaceStored(410, 'imperial')).toBe(255)
    expect(runPaceShown(255, 'metric')).toBe(255)
    expect(Math.round(swimPaceShown(100, 'imperial'))).toBe(91)
    expect(swimPaceStored(91.44, 'imperial')).toBe(100)
  })
})
