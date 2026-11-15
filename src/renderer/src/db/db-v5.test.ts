import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { createBackup, restoreBackup } from './backup'
import { CrankHogDb, db, type OtherActivity } from './db'
import type { DayMark, TrainingPlan } from '@core/workout/plan'

const plan: TrainingPlan = { id: 'p1', name: 'Base 1', items: [{ workoutId: 'w' }], rideDays: [1, 3], startDate: '2026-11-16', onCalendar: false, source: 'manual', createdAt: 1, updatedAt: 1 }
const run: OtherActivity = { id: 'a1', startedAt: 1, sport: 'running', subSport: null, name: 'Morning run', movingS: 1800, distanceM: 5000, avgHr: 150, maxHr: 170, hrLoad: 40, trainingEffect: { aerobic: 3, anaerobic: 1 }, garminLoad: 80, device: null, fileName: 'run.fit' }
const mark: DayMark = { id: 'd1', date: '2026-12-06', kind: 'event', name: 'Gran fondo', priority: 'A' }

beforeEach(async () => {
  await db().delete()
  await db().open()
})

describe('database version 5', () => {
  it('opens a version 4 database, keeping its schedule, and adds plans, activities and day marks', async () => {
    const name = 'v5-upgrade-test'
    await Dexie.delete(name)
    const v4 = new Dexie(name)
    v4.version(4).stores({ rides: 'id, startedAt, kind, simulated, workoutId', rideStreams: 'rideId', workouts: 'id, name, source, updatedAt, favorite, *tags', ftpHistory: '++id, date, source', profile: '++id, from', kv: 'key', routes: 'id, name, importedAt', routeRides: 'rideId, routeId, startedAt', journeys: 'id, courseId, updatedAt', schedule: 'id, date, source' })
    await v4.open()
    await v4.table('schedule').put({ id: 's1', date: '2026-11-18', workoutId: 'w', workout: null, name: 'Kept', source: 'manual', createdAt: 1 })
    v4.close()
    const upgraded = new CrankHogDb(name)
    await upgraded.open()
    expect(await upgraded.schedule.get('s1')).toMatchObject({ name: 'Kept' })
    expect([await upgraded.plans.count(), await upgraded.activities.count(), await upgraded.dayMarks.count()]).toEqual([0, 0, 0])
    upgraded.close()
  })

  it('backs up plans, activities and day marks, and restores them', async () => {
    await db().plans.put(plan)
    await db().activities.put(run)
    await db().dayMarks.put(mark)
    const zip = await createBackup()
    await Promise.all([db().plans.clear(), db().activities.clear(), db().dayMarks.clear()])
    await restoreBackup(zip)
    expect(await db().plans.get('p1')).toEqual(plan)
    expect(await db().activities.get('a1')).toEqual(run)
    expect(await db().dayMarks.get('d1')).toEqual(mark)
  })
})
