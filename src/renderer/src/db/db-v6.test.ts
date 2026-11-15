import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { strToU8, zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionWorkout } from '@core/multisport/model'
import { BACKUP_FORMAT, createBackup, restoreBackup } from './backup'
import { CrankHogDb, db, type OtherActivity } from './db'

// the schema 1.0.0 shipped with
const V5 = {
  rides: 'id, startedAt, kind, simulated, workoutId',
  rideStreams: 'rideId',
  workouts: 'id, name, source, updatedAt, favorite, *tags',
  ftpHistory: '++id, date, source',
  profile: '++id, from',
  kv: 'key',
  routes: 'id, name, importedAt',
  routeRides: 'rideId, routeId, startedAt',
  journeys: 'id, courseId, updatedAt',
  schedule: 'id, date, source',
  plans: 'id, updatedAt',
  activities: 'id, startedAt, sport',
  dayMarks: 'id, date, kind',
}

const fitRow = (id: string, sport: string, subSport: string | null): OtherActivity => ({ id, startedAt: 1, sport, subSport, name: id, movingS: 1800, distanceM: null, avgHr: null, maxHr: null, hrLoad: 30, trainingEffect: null, garminLoad: null, device: null, fileName: `${id}.fit` })

const session: SessionWorkout = { id: 'sw1', sport: 'run', name: 'Threshold 4x8', text: 'sport: run\n\n- 10m Z2 HR', tags: [], source: 'import', createdAt: 1, updatedAt: 1 }

beforeEach(async () => {
  await db().delete()
  await db().open()
})

describe('database version 6', () => {
  it('upgrades a 1.0.0 database: every activity came from a FIT file and gets its sport group', async () => {
    const name = 'v6-upgrade-test'
    await Dexie.delete(name)
    const v5 = new Dexie(name)
    v5.version(5).stores(V5)
    await v5.open()
    await v5.table('activities').bulkPut([fitRow('run', 'running', null), fitRow('swim', 'swimming', 'lap_swimming'), fitRow('squash', 'racket', 'squash')])
    v5.close()
    const upgraded = new CrankHogDb(name)
    await upgraded.open()
    const rows = await upgraded.activities.orderBy('id').toArray()
    expect(rows.map((a) => [a.id, a.source, a.group])).toEqual([
      ['run', 'fit', 'run'],
      ['squash', 'fit', 'other'],
      ['swim', 'fit', 'swim'],
    ])
    expect(await upgraded.activities.where('source').equals('fit').count()).toBe(3)
    expect(await upgraded.sessionWorkouts.count()).toBe(0)
    upgraded.close()
  })

  it('backs up and restores session workouts', async () => {
    await db().sessionWorkouts.put(session)
    const zip = await createBackup()
    await db().sessionWorkouts.clear()
    await restoreBackup(zip)
    expect(await db().sessionWorkouts.get('sw1')).toEqual(session)
  })

  it('restores a 1.0.0 backup, filling in each activity’s source and group', async () => {
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: BACKUP_FORMAT, version: 2, createdAt: 1 })),
      'activities.json': strToU8(JSON.stringify([fitRow('squash', 'racket', 'squash')])),
    })
    await restoreBackup(zip)
    expect(await db().activities.get('squash')).toMatchObject({ source: 'fit', group: 'other' })
  })

  it('keeps what a newer row says about itself', async () => {
    const manual: OtherActivity = { ...fitRow('m', 'generic', null), fileName: undefined, source: 'manual', group: 'other', label: 'Squash', manualLoad: 80, effort: 'hard' }
    await db().activities.put(manual)
    await restoreBackup(await createBackup())
    expect(await db().activities.get('m')).toEqual(manual)
  })
})
