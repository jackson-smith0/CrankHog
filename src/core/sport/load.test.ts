import { describe, expect, it } from 'vitest'
import { activityLoad, effortLoad } from './load'

describe('effortLoad', () => {
  it('scores an hour by how hard it was', () => {
    expect(effortLoad(3600, 'easy')).toBe(40)
    expect(effortLoad(3600, 'hard')).toBe(80)
    expect(effortLoad(2700, 'max')).toBe(75)
  })

  it('is unknown without a length or an effort, never zero', () => {
    expect(effortLoad(null, 'hard')).toBeNull()
    expect(effortLoad(0, 'hard')).toBeNull()
    expect(effortLoad(3600, null)).toBeNull()
  })
})

describe('activityLoad', () => {
  it('prefers its own heart-rate score, then intervals.icu, then the rider', () => {
    expect(activityLoad({ hrLoad: 52, icuLoad: 60, manualLoad: 70 })).toBe(52)
    expect(activityLoad({ hrLoad: null, icuLoad: 60, manualLoad: 70 })).toBe(60)
    expect(activityLoad({ manualLoad: 70 })).toBe(70)
  })

  it('keeps a real zero, and is null when nothing is known', () => {
    expect(activityLoad({ hrLoad: 0 })).toBe(0)
    expect(activityLoad({ hrLoad: Number.NaN })).toBeNull()
    expect(activityLoad({})).toBeNull()
  })
})
