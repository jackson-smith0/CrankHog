import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RideSummary } from '@core/ride/types'
import { fitnessFacts } from '../ai/client'
import { db, type OtherActivity } from './db'
import { pmcSeries, weeklyLoad } from './fitness'

const DAY = 86_400_000
const yesterday = Date.now() - DAY

const ride = { id: 'r1', startedAt: yesterday, endedAt: yesterday + 3600_000, movingS: 3600, tss: 60, kj: 700, simulated: false, mmp: [] } as unknown as RideSummary
const squash: OtherActivity = { id: 'a1', startedAt: yesterday + 7200_000, sport: 'racket', subSport: 'squash', name: 'Evening squash', movingS: 3600, distanceM: null, avgHr: 150, maxHr: 180, hrLoad: 70, trainingEffect: null, garminLoad: null, device: null, fileName: 'squash.fit' }

beforeEach(async () => {
  await db().delete()
  await db().open()
  await db().rides.put(ride)
  await db().activities.put(squash)
})

describe('fitness counts every sport, the AI only rides', () => {
  it('puts a squash game in fitness and fatigue alongside the ride', async () => {
    const all = (await pmcSeries(3)).at(-1)!
    const rides = (await pmcSeries(3, { sports: 'rides' })).at(-1)!
    expect(all.atl).toBeGreaterThan(rides.atl)
    expect(all.ctl).toBeGreaterThan(rides.ctl)
  })

  it('adds the squash load and time to the weeks, counted apart from rides', async () => {
    // two weeks, so yesterday is in range even on a Monday
    const weeks = await weeklyLoad(2)
    const sum = (k: 'tss' | 'hours' | 'rides' | 'others') => weeks.reduce((s, w) => s + w[k], 0)
    expect([sum('tss'), sum('hours'), sum('rides'), sum('others')]).toEqual([130, 2, 1, 1])
    expect((await weeklyLoad(2, { sports: 'rides' })).reduce((s, w) => s + w.others, 0)).toBe(0)
  })

  it('gives the AI fitness from rides alone', async () => {
    const facts = await fitnessFacts()
    const rides = (await pmcSeries(42, { sports: 'rides' })).at(-1)!
    expect(facts.atl).toBeCloseTo(rides.atl)
    expect(facts.weeklyTss.reduce((s, t) => s + t, 0)).toBe(60)
  })
})
