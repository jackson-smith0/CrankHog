import { describe, expect, it } from 'vitest'
import type { Beep } from '@core/ride/countdown'
import { IDLE_TICK, type PlanTick } from '@core/ride/plan'
import type { SessionState } from '@core/ride/session'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import { BeepRuntime, type BeepSession } from './beeps'

/** A ride whose plan tick and state the test moves by hand. */
class FakeRide implements BeepSession {
  currentState: SessionState = 'riding'
  planTick: PlanTick = IDLE_TICK
  at(segmentIndex: number, durationS: number, remainingS: number): void {
    this.planTick = { ...IDLE_TICK, segmentIndex, segmentRemainingS: remainingS, segmentElapsedS: durationS - remainingS }
  }
}

function rig(settings: AppSettings = DEFAULT_SETTINGS) {
  let startSession: ((s: BeepSession) => void) | null = null
  const tickers = new Set<(now: number) => void>()
  const played: [Beep, number][] = []
  let current = settings
  const rt = new BeepRuntime({
    rides: { onSessionStart: (l) => ((startSession = l), () => (startSession = null)) },
    engine: { onTick: (fn) => (tickers.add(fn), () => tickers.delete(fn)) },
    settings: () => current,
    play: (beep, volume) => played.push([beep, volume]),
  })
  rt.start()
  return {
    rt,
    played,
    begin: (s: BeepSession) => startSession!(s),
    tick: () => tickers.forEach((fn) => fn(0)),
    set: (s: AppSettings) => (current = s),
    tickers,
  }
}

describe('BeepRuntime', () => {
  it('plays the countdown and the go of a workout at the set volume', () => {
    const r = rig({ ...DEFAULT_SETTINGS, beeps: { enabled: true, volume: 0.4 } })
    const ride = new FakeRide()
    r.begin(ride)
    for (const remaining of [3, 2, 1]) {
      ride.at(0, 60, remaining)
      r.tick()
    }
    ride.at(1, 60, 60)
    r.tick()
    expect(r.played).toEqual([
      ['tick', 0.4],
      ['tick', 0.4],
      ['tick', 0.4],
      ['go', 0.4],
    ])
  })

  it('plays nothing when switched off, and picks up again mid-ride when switched on', () => {
    const r = rig({ ...DEFAULT_SETTINGS, beeps: { enabled: false, volume: 0.6 } })
    const ride = new FakeRide()
    r.begin(ride)
    ride.at(0, 60, 3)
    r.tick()
    expect(r.played).toEqual([])
    r.set(DEFAULT_SETTINGS)
    ride.at(0, 60, 2)
    r.tick()
    expect(r.played).toEqual([['tick', 0.6]])
  })

  it('stays quiet while the ride is paused', () => {
    const r = rig()
    const ride = new FakeRide()
    r.begin(ride)
    ride.currentState = 'paused'
    ride.at(0, 60, 2)
    r.tick()
    expect(r.played).toEqual([])
  })

  it('follows only the newest ride, and lets go of a finished one', () => {
    const r = rig()
    const first = new FakeRide()
    r.begin(first)
    const second = new FakeRide()
    r.begin(second)
    first.at(0, 60, 2)
    second.at(0, 60, 100)
    r.tick()
    expect(r.played).toEqual([])
    second.currentState = 'finished'
    r.tick()
    expect(r.tickers.size).toBe(0)
  })
})
