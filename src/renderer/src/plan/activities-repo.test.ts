import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, dateKey } from '@core/workout/schedule'
import { db } from '../db/db'
import { HIDDEN_KEY, addManualActivity, manualStart, removeActivity, removeWarning, updateManualActivity } from './activities-repo'

beforeEach(async () => {
  await db().delete()
  await db().open()
})

const today = dateKey(Date.now())

describe('activities entered by hand', () => {
  it('saves a squash game with its load from how hard it was', async () => {
    const a = await addManualActivity({ date: addDays(today, -1), group: 'other', label: ' Squash ', durationS: 3600, effort: 'hard' })
    expect(await db().activities.get(a.id)).toMatchObject({ name: 'Squash', label: 'Squash', group: 'other', source: 'manual', movingS: 3600, manualLoad: 80, hrLoad: null, sport: 'generic' })
  })

  it('takes a load typed in over the effort, and names an unlabelled run "Run"', async () => {
    const a = await addManualActivity({ date: today, group: 'run', durationS: 1800, distanceM: 6000, effort: 'easy', load: 33 })
    expect(a).toMatchObject({ name: 'Run', manualLoad: 33, distanceM: 6000 })
    expect(dateKey(a.startedAt)).toBe(today)
  })

  it('puts a past day’s activity at midday, and today’s as just finished', () => {
    const now = new Date(2026, 10, 18, 19).getTime()
    expect(new Date(manualStart('2026-11-17', 3600, now)).getHours()).toBe(12)
    expect(manualStart('2026-11-18', 3600, now)).toBe(now - 3_600_000)
  })

  it('edits one entered by hand, and refuses to edit a FIT import', async () => {
    const a = await addManualActivity({ date: addDays(today, -2), group: 'run', durationS: 1800 })
    await updateManualActivity(a.id, { date: addDays(today, -2), group: 'run', label: 'Long run', durationS: 5400, effort: 'moderate' })
    expect(await db().activities.get(a.id)).toMatchObject({ name: 'Long run', movingS: 5400, manualLoad: 90, startedAt: a.startedAt })
    await db().activities.put({ id: 'fit', startedAt: 1, sport: 'running', subSport: null, name: 'Run', movingS: 1, distanceM: null, avgHr: null, maxHr: null, hrLoad: null, trainingEffect: null, garminLoad: null, device: null, source: 'fit' })
    await expect(updateManualActivity('fit', { date: today, group: 'run', durationS: 60 })).rejects.toThrow(/entered by hand/)
  })
})

describe('removing an activity', () => {
  it('remembers one from intervals.icu so a sync leaves it out', async () => {
    await db().activities.put({ id: 'icu-1', startedAt: 1, sport: 'Run', subSport: null, name: 'Run', movingS: 1, distanceM: null, avgHr: null, maxHr: null, hrLoad: null, trainingEffect: null, garminLoad: null, device: null, source: 'intervals', externalId: 'i1' })
    await removeActivity({ id: 'icu-1', source: 'intervals', externalId: 'i1' })
    await removeActivity({ id: 'icu-1', source: 'intervals', externalId: 'i1' })
    expect(await db().activities.count()).toBe(0)
    expect((await db().kv.get(HIDDEN_KEY))?.value).toEqual(['i1'])
  })

  it('says what removing means for each source', () => {
    expect(removeWarning({ source: 'fit' })).toMatch(/Importing its file again brings it back/)
    expect(removeWarning({ source: undefined })).toMatch(/Importing its file again/)
    expect(removeWarning({ source: 'manual' })).toMatch(/can’t be undone/)
    expect(removeWarning({ source: 'intervals' })).toMatch(/won’t come back from intervals.icu/)
    expect(removeWarning({ source: 'fit', externalId: 'i9' })).toMatch(/intervals.icu/)
  })
})
