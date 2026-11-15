// The saved ride and its FIT leave out pauses and dead edges (see trim.ts).
import { Decoder, Stream } from '@garmin/fitsdk'
import { describe, expect, it } from 'vitest'
import { finalizeRide, type FinalizeInput } from './finalize'
import type { RideRecord } from './recorder'

const T0 = Date.UTC(2026, 10, 15, 14, 51, 0)

/** A morning like the 15 Nov one: 20 s standing over the bike, 10 min riding, a 25 min stop, 10 min more. */
function morning(): RideRecord[] {
  const out: RideRecord[] = []
  let ts = T0
  const push = (power: number, cadence: number, lap: number) => {
    ts += 1000
    out.push({
      t: out.length, ts, power, cadence, hr: 130, speed: power > 0 ? 9 : 0, distance: 0, altitude: null, grade: null,
      targetW: 180, lrBalance: null, coreTemp: null, skinTemp: null, smo2: null, lap, rr: [],
    })
  }
  for (let i = 0; i < 20; i++) push(0, 0, 0)
  for (let i = 0; i < 600; i++) push(180, 90, 0)
  for (let i = 0; i < 3; i++) push(0, 0, 0) // what set off the auto-pause
  ts += 25 * 60_000
  for (let i = 0; i < 600; i++) push(200, 90, 1)
  let d = 0
  for (const r of out) r.distance = d += r.speed ?? 0
  return out
}

const input = (records: RideRecord[], extra: Partial<FinalizeInput> = {}): FinalizeInput => ({
  rideId: 'r-morning', name: 'Endurance 120', kind: 'workout', simulated: false, startedAt: T0, athlete: { ftpW: 250, weightKg: 75 },
  records, utcOffsetMin: -300, softwareVersion: 10, now: T0, ...extra,
})

describe('finalizeRide', () => {
  it('saves only the riding: elapsed equals moving in the summary and in the FIT', () => {
    const records = morning()
    const fin = finalizeRide(input(records))
    expect(fin.summary.movingS).toBe(1200)
    expect(fin.summary.elapsedS).toBe(1200)
    expect(fin.summary.startedAt).toBe(records[20]!.ts - 1000)
    expect(fin.summary.endedAt).toBe(fin.summary.startedAt + 1200_000)
    expect(fin.summary.avgPower).toBe(190)
    expect(fin.streams.length).toBe(1200)
    expect(fin.summary.laps.map((l) => l.durationS)).toEqual([600, 600])

    const dec = new Decoder(Stream.fromByteArray(Array.from(fin.fit!)))
    expect(dec.checkIntegrity()).toBe(true)
    const { messages } = dec.read()
    const session = messages.sessionMesgs![0]!
    expect(session.totalElapsedTime).toBe(1200)
    expect(session.totalTimerTime).toBe(1200)
    expect(messages.recordMesgs).toHaveLength(1200)
    expect(messages.eventMesgs!.filter((e) => e.event === 'timer').map((e) => e.eventType)).toEqual(['start', 'stopAll'])
    const times = messages.recordMesgs!.map((r) => (r.timestamp as Date).getTime())
    expect(times.slice(1).every((t, i) => t - times[i]! === 1000)).toBe(true)
  })

  it('keeps an imported file as its device recorded it', () => {
    const records = morning()
    const fin = finalizeRide(input(records, { imported: { fileName: 'garmin.fit' } }))
    expect(fin.summary.movingS).toBe(records.length)
    expect(fin.fit).toBeNull()
  })

  it('keeps lap labels on their laps when a whole lap was dead time', () => {
    const records = morning()
    // lap 0 becomes the 20 dead seconds alone; the riding moves to laps 1 and 2
    records.forEach((r, i) => (r.lap = i < 20 ? 0 : r.lap + 1))
    const fin = finalizeRide(input(records, { lapLabels: ['Get on', 'Warm up', 'Steady'] }))
    expect(fin.summary.laps.map((l) => l.label)).toEqual(['Warm up', 'Steady'])
  })
})
