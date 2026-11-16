import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RideSummary } from '@core/ride/types'
import { addDays, dateKey } from '@core/workout/schedule'
import type { CrankHogBridge } from '@shared/ipc/contract'
import { db } from '../db/db'
import { settingsStore } from '../stores/settings'
import { removeActivity } from './activities-repo'
import { FIRST_SYNC_DAYS, RESYNC_DAYS, lastActivitySync, syncIfOn, syncIntervalsActivities } from './intervals-activities'

const invoke = vi.fn()
const NOW = new Date(2026, 10, 18, 21).getTime()
const today = dateKey(NOW)
const at = (h: number) => new Date(2026, 10, 18, h).getTime()

const icu = (id: string, startedAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  start_date_local: '2026-11-18T07:00:00',
  start_date: new Date(startedAt).toISOString(),
  type: 'Run',
  name: 'Morning Run',
  moving_time: 2400,
  distance: 8000,
  average_heartrate: 150,
  max_heartrate: 170,
  icu_training_load: 52,
  source: 'GARMIN_CONNECT',
  external_id: null,
  ...extra,
})

const respond = (activities: unknown[], fromStrava = 0) =>
  invoke.mockImplementation(async (channel: string) => (channel === 'intervals.status' ? { configured: true } : { activities, fromStrava }))

beforeEach(async () => {
  await db().delete()
  await db().open()
  invoke.mockReset()
  window.crankhog = { invoke, on: () => () => undefined, send: () => undefined } as unknown as CrankHogBridge
})

describe('syncIntervalsActivities', () => {
  it('looks back 90 days the first time and two weeks after, and adds a run and a squash game', async () => {
    respond([icu('i1', at(7)), icu('i2', at(19), { type: 'Squash', name: 'Squash', distance: null, icu_training_load: 70 })], 3)
    const r = await syncIntervalsActivities(NOW)
    expect(invoke).toHaveBeenCalledWith('intervals.activities', { oldest: addDays(today, -FIRST_SYNC_DAYS), newest: today })
    expect(r).toMatchObject({ added: 2, updated: 0, removed: 0, fromStrava: 3 })
    expect(await db().activities.get('icu-i2')).toMatchObject({ source: 'intervals', group: 'other', icuLoad: 70, externalId: 'i2', hrLoad: null })
    expect(await lastActivitySync()).toMatchObject({ fromStrava: 3, at: NOW })

    respond([icu('i1', at(7), { icu_training_load: 55 })])
    const again = await syncIntervalsActivities(NOW + 3_600_000)
    expect(invoke).toHaveBeenLastCalledWith('intervals.activities', { oldest: addDays(today, -RESYNC_DAYS), newest: today })
    // the squash game is gone from intervals.icu, so it goes here too
    expect(again).toMatchObject({ added: 0, updated: 1, removed: 1 })
    expect((await db().activities.toArray()).map((a) => [a.id, a.icuLoad])).toEqual([['icu-i1', 55]])
  })

  it('leaves out a ride already in the history, matches a FIT import, and keeps out what was removed', async () => {
    await db().rides.put({ id: 'r1', startedAt: at(8), simulated: false } as unknown as RideSummary)
    await db().activities.put({ id: 'act-1', startedAt: at(7) + 10_000, sport: 'running', subSport: null, name: 'Morning run', movingS: 2400, distanceM: 8000, avgHr: 150, maxHr: 170, hrLoad: 48, trainingEffect: null, garminLoad: null, device: null, fileName: 'run.fit', source: 'fit', group: 'run' })
    respond([icu('i1', at(7)), icu('ride', at(8), { type: 'Ride' }), icu('i3', at(12))])
    await syncIntervalsActivities(NOW)
    expect(await db().activities.get('act-1')).toMatchObject({ externalId: 'i1', icuLoad: 52, hrLoad: 48 })
    expect(await db().activities.get('icu-ride')).toBeUndefined()
    expect(await db().activities.get('icu-i3')).toBeTruthy()

    await removeActivity((await db().activities.get('icu-i3'))!)
    await syncIntervalsActivities(NOW + 60_000)
    expect(await db().activities.get('icu-i3')).toBeUndefined()
  })
})

describe('syncIfOn', () => {
  it('does nothing until the rider turns it on', async () => {
    respond([icu('i1', at(7))])
    settingsStore.setState({ ...settingsStore.getState(), intervalsSync: { activities: false } })
    expect(await syncIfOn(NOW)).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    settingsStore.setState({ ...settingsStore.getState(), intervalsSync: { activities: true } })
    expect(await syncIfOn(NOW)).toMatchObject({ added: 1 })
  })

  it('does nothing without intervals.icu set up, and swallows a failure for the next try', async () => {
    settingsStore.setState({ ...settingsStore.getState(), intervalsSync: { activities: true } })
    invoke.mockImplementation(async (channel: string) => (channel === 'intervals.status' ? { configured: false } : { activities: [], fromStrava: 0 }))
    expect(await syncIfOn(NOW)).toBeNull()
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'intervals.status') return { configured: true }
      throw new Error('offline')
    })
    expect(await syncIfOn(NOW)).toBeNull()
  })
})
