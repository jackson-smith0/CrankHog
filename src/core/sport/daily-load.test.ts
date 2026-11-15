import { describe, expect, it } from 'vitest'
import { computePmc } from '../metrics/pmc'
import { dailyLoad } from './daily-load'

const at = (d: number, h = 18) => new Date(2026, 10, d, h).getTime()

describe('dailyLoad', () => {
  it('puts ride TSS and other sports on their local days, leaving out simulated rides', () => {
    const days = dailyLoad({
      rides: [
        { startedAt: at(16), tss: 60, simulated: false },
        { startedAt: at(16, 7), tss: 500, simulated: true },
        { startedAt: at(17), tss: null, simulated: false },
      ],
      activities: [
        { startedAt: at(16, 20), load: 45 },
        { startedAt: at(18), load: null },
      ],
    })
    expect(days).toEqual([
      { date: '2026-11-16', tss: 60 },
      { date: '2026-11-16', tss: 45 },
      { date: '2026-11-17', tss: 0 },
      { date: '2026-11-18', tss: 0 },
    ])
  })

  it('lets a squash game move fitness and fatigue like a ride of the same load', () => {
    const ride = computePmc(dailyLoad({ rides: [{ startedAt: at(16), tss: 70, simulated: false }] }), { to: '2026-11-20' })
    const squash = computePmc(dailyLoad({ rides: [], activities: [{ startedAt: at(16), load: 70 }] }), { to: '2026-11-20' })
    expect(squash).toEqual(ride)
  })
})
