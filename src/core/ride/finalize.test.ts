// The saved ride and its FIT leave out pauses (see close-pauses.ts).
import { Decoder, Stream } from '@garmin/fitsdk'
import { describe, expect, it } from 'vitest'
import { finalizeRide, type FinalizeInput } from './finalize'
import type { RideRecord } from './recorder'

const T0 = Date.UTC(2026, 10, 15, 14, 51, 0)

/** A morning like the 15 Nov one: 10 min riding, the 3 s of zeros that set off the auto-pause, a 25 min stop, 10 min more. */
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
  for (let i = 0; i < 600; i++) push(180, 90, 0)
  for (let i = 0; i < 3; i++) push(0, 0, 0)
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
  it('leaves the pause out: elapsed equals moving in the summary and in the FIT', () => {
    const records = morning()
    const fin = finalizeRide(input(records))
    expect(fin.summary.movingS).toBe(1203)
    expect(fin.summary.elapsedS).toBe(1203)
    expect(fin.summary.startedAt).toBe(records[0]!.ts - 1000)
    expect(fin.summary.endedAt).toBe(fin.summary.startedAt + 1203_000)
    expect(fin.streams.length).toBe(1203)
    expect(fin.summary.laps.map((l) => l.durationS)).toEqual([603, 600])
    expect(fin.summary.distanceM).toBe(records.at(-1)!.distance)

    const dec = new Decoder(Stream.fromByteArray(Array.from(fin.fit!)))
    expect(dec.checkIntegrity()).toBe(true)
    const { messages } = dec.read()
    const session = messages.sessionMesgs![0]!
    // what Strava and intervals.icu read as elapsed and moving time
    expect(session.totalElapsedTime).toBe(1203)
    expect(session.totalTimerTime).toBe(1203)
    expect(messages.recordMesgs).toHaveLength(1203)
    expect(messages.eventMesgs!.filter((e) => e.event === 'timer').map((e) => e.eventType)).toEqual(['start', 'stopAll'])
    const times = messages.recordMesgs!.map((r) => (r.timestamp as Date).getTime())
    expect(times.slice(1).every((t, i) => t - times[i]! === 1000)).toBe(true)
  })

  it('keeps a workout interval as long as planned when an auto-pause fell inside it', () => {
    const records = morning()
    // a 5:00 interval: 150 s, the 3 s of zeros, the stop, 147 s more
    const interval = [...records.slice(450, 603), ...records.slice(603, 750)]
    interval.forEach((r, i) => Object.assign(r, { t: i, lap: 0 }))
    const fin = finalizeRide(input(interval))
    expect(fin.summary.movingS).toBe(300)
    expect(fin.summary.laps.map((l) => l.durationS)).toEqual([300])
  })

  it('keeps an imported file as its device recorded it', () => {
    const records = morning()
    const fin = finalizeRide(input(records, { imported: { fileName: 'garmin.fit' } }))
    expect(fin.summary.movingS).toBe(records.length)
    expect(fin.summary.elapsedS).toBe(records.length + 25 * 60)
    expect(fin.fit).toBeNull()
  })
})
