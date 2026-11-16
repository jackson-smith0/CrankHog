import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { TrainerController } from '@core/control/trainer-controller'
import { RideSession, type JournalSink } from '@core/ride/session'
import { SensorHub } from '@core/sensors/hub'
import { FakeClock } from '@core/time/clock'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { bridge } from '../platform/bridge'
import { createWebShim } from '../platform/web-shim'
import { settingsStore } from '../stores/settings'
import { db } from './db'
import { pendingRecoveries, recoverRide } from './rides-repo'

// the journal sink the ride runner uses, through the web shim's journal
const journal: JournalSink = {
  begin: async (rideId, meta) => {
    await bridge().invoke('journal.begin', { rideId, meta })
  },
  append: async (rideId, seq, lines) => (await bridge().invoke('journal.append', { rideId, seq, lines })).durableSeq,
  close: async (rideId) => {
    await bridge().invoke('journal.close', { rideId })
  },
}

/** A ride on a classic trainer with a speed sensor and an HR strap, left behind by a crash after `seconds`. */
async function crashedSpeedRide(rideId: string, seconds: number) {
  const clock = new FakeClock(Date.UTC(2026, 10, 15, 7, 0, 0))
  const hub = new SensorHub()
  const session = new RideSession(
    { clock, hub, controller: new TrainerController(), journal, setPaused: () => undefined },
    { rideId, name: 'Morning spin', kind: 'free', simulated: false, athlete: { ftpW: 250, weightKg: 75 }, autoPause: true },
  )
  session.start()
  session.command({ type: 'togglePause' }) // "Start now"
  for (let t = 250; t <= seconds * 1000; t += 250) {
    clock.advance(250)
    hub.ingest({ metric: 'speed', value: 9, tMono: t, sourceId: 'csc:wheel' })
    if (t % 1000 === 0) hub.ingest({ metric: 'hr', value: 140, tMono: t, sourceId: 'hr:hrs' })
    session.tick(t)
    await new Promise((r) => setTimeout(r, 0))
  }
  return session
}

beforeEach(async () => {
  window.crankhog = createWebShim()
  localStorage.clear()
  settingsStore.setState(DEFAULT_SETTINGS, true)
  await db().delete()
  await db().open()
})

describe('recovering a crashed ride', () => {
  it('recovers every second of a speed-and-HR ride started by hand, and only then lets the journal go', async () => {
    const session = await crashedSpeedRide('r-speed', 600)
    expect(session.records.length).toBeGreaterThanOrEqual(599)
    const [pending] = await pendingRecoveries()
    expect(pending).toMatchObject({ rideId: 'r-speed', name: 'Morning spin' })

    const saved = await recoverRide('r-speed')
    expect(saved!.summary).toMatchObject({ movingS: session.records.length, elapsedS: session.records.length, recovered: true, avgHr: 140 })
    expect(saved!.summary.distanceM).toBeGreaterThan(5000)
    expect((await db().rides.get('r-speed'))!.movingS).toBe(session.records.length)
    expect(await pendingRecoveries()).toEqual([])
  })

  it('lets a journal of a few seconds go, as finishing would have', async () => {
    await crashedSpeedRide('r-blip', 3)
    expect(await pendingRecoveries()).toEqual([])
    expect((await bridge().invoke('journal.pending', {})).journals).toEqual([])
    expect(await recoverRide('r-blip')).toBeNull()
  })
})
