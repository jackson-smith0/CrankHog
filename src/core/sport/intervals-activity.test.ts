import { describe, expect, it } from 'vitest'
import { icuStart, planIntervalsSync, type IcuActivity, type StoredActivityRef } from './intervals-activity'

const t = (h: number, m = 0) => Date.UTC(2026, 10, 18, h, m)
const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '')

const icu = (id: string, at: number, extra: Partial<IcuActivity> = {}): IcuActivity => ({
  id,
  start_date_local: '2026-11-18T07:00:00',
  start_date: iso(at),
  type: 'Run',
  name: 'Morning Run',
  moving_time: 2400,
  distance: 8000,
  average_heartrate: 150.4,
  max_heartrate: 171.6,
  icu_training_load: 52,
  source: 'GARMIN_CONNECT',
  external_id: null,
  ...extra,
})

const window = [t(0), t(24)] as const
const plan = (fetched: IcuActivity[], existing: StoredActivityRef[] = [], rides: { startedAt: number }[] = [], hidden: string[] = []) =>
  planIntervalsSync({ fetched, existing, rides, hidden: new Set(hidden), window })

describe('planIntervalsSync', () => {
  it('adds a Garmin run and a squash game, each in its sport group, with intervals.icu’s load', () => {
    const p = plan([icu('i1', t(15)), icu('i2', t(19), { type: 'Squash', name: '', distance: 0, icu_training_load: 70 })])
    expect(p.put).toEqual([
      { id: 'icu-i1', startedAt: t(15), sport: 'Run', name: 'Morning Run', movingS: 2400, distanceM: 8000, avgHr: 150, maxHr: 172, icuLoad: 52, group: 'run', externalId: 'i1' },
      expect.objectContaining({ id: 'icu-i2', name: 'Squash', group: 'other', distanceM: null, icuLoad: 70 }),
    ])
    expect(p.counts).toMatchObject({ added: 2, updated: 0 })
  })

  it('leaves out CrankHog’s own uploads, anything on top of a ride in the history, and what the rider removed', () => {
    const p = plan([icu('own', t(6), { type: 'VirtualRide', external_id: 'freegaz-r1' }), icu('dup', t(8), { type: 'Ride' }), icu('gone', t(12))], [], [{ startedAt: t(8) + 30_000 }], ['gone'])
    expect(p.put).toEqual([])
    expect(p.counts).toMatchObject({ ownUploads: 1, rides: 1, hidden: 1, added: 0 })
  })

  it('keeps an outdoor ride from Garmin as a ride in volume', () => {
    expect(plan([icu('r', t(9), { type: 'GravelRide' })]).put[0]!.group).toBe('ride')
  })

  it('matches a run already imported from its FIT file instead of adding it twice', () => {
    const p = plan([icu('i1', t(15))], [{ id: 'act-x', startedAt: t(15) + 20_000, source: 'fit' }])
    expect(p.put).toEqual([])
    expect(p.attach).toEqual([{ id: 'act-x', externalId: 'i1', icuLoad: 52 }])
    // once matched, a later sync leaves it alone
    const again = plan([icu('i1', t(15))], [{ id: 'act-x', startedAt: t(15) + 20_000, source: 'fit', externalId: 'i1' }])
    expect([again.put, again.attach, again.remove]).toEqual([[], [], []])
  })

  it('updates one an earlier sync added, and removes one intervals.icu no longer has in the range', () => {
    const existing: StoredActivityRef[] = [
      { id: 'icu-i1', startedAt: t(15), source: 'intervals', externalId: 'i1' },
      { id: 'icu-old', startedAt: t(10), source: 'intervals', externalId: 'old' },
      { id: 'icu-outside', startedAt: t(-30), source: 'intervals', externalId: 'outside' },
      { id: 'man-1', startedAt: t(11), source: 'manual' },
    ]
    const p = plan([icu('i1', t(15), { icu_training_load: 60 })], existing)
    expect(p.put).toEqual([expect.objectContaining({ id: 'icu-i1', icuLoad: 60 })])
    expect(p.remove).toEqual(['icu-old'])
    expect(p.counts).toMatchObject({ updated: 1, removed: 1 })
  })
})

describe('icuStart', () => {
  it('uses the UTC start when given, else the local start as local time', () => {
    expect(icuStart({ start_date: '2026-11-18T15:00:00Z', start_date_local: '2026-11-18T07:00:00' })).toBe(t(15))
    expect(icuStart({ start_date: null, start_date_local: '2026-11-18T07:30:00' })).toBe(new Date(2026, 10, 18, 7, 30).getTime())
    expect(icuStart({ start_date: null, start_date_local: 'nonsense' })).toBeNull()
  })
})
