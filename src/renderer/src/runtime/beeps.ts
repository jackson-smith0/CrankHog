// Countdown beeps during rides. Created once in the composition root, it
// follows each ride's plan tick and plays what @core/ride/countdown asks for.
// It is separate from the coach on purpose: muting or switching off the coach
// leaves the beeps on.
import { IntervalCountdown, type Beep } from '@core/ride/countdown'
import type { RideSession } from '@core/ride/session'
import type { AppSettings } from '@shared/settings'

export type BeepSession = Pick<RideSession, 'planTick' | 'currentState'>

export interface BeepRuntimeDeps {
  rides: { onSessionStart(listener: (session: BeepSession) => void): () => void }
  engine: { onTick(fn: (now: number) => void): () => void }
  settings: () => AppSettings
  play: (beep: Beep, volume: number) => void
}

export class BeepRuntime {
  private offStart: (() => void) | null = null
  private offTick: (() => void) | null = null

  constructor(private readonly deps: BeepRuntimeDeps) {}

  start(): void {
    if (this.offStart) return
    this.offStart = this.deps.rides.onSessionStart((s) => this.follow(s))
  }

  stop(): void {
    this.offStart?.()
    this.offStart = null
    this.release()
  }

  private follow(session: BeepSession): void {
    this.release()
    const countdown = new IntervalCountdown()
    this.offTick = this.deps.engine.onTick(() => {
      const state = session.currentState
      const tick = session.planTick
      // always fed, so switching the beeps on mid-ride picks up cleanly
      const beeps = countdown.tick({
        riding: state === 'riding',
        finished: tick.finished,
        segmentIndex: tick.segmentIndex,
        segmentRemainingS: tick.segmentRemainingS,
        segmentElapsedS: tick.segmentElapsedS,
      })
      const prefs = this.deps.settings().beeps
      if (prefs.enabled) for (const b of beeps) this.deps.play(b, prefs.volume)
      if (state === 'finished') this.release()
    })
  }

  private release(): void {
    this.offTick?.()
    this.offTick = null
  }
}
