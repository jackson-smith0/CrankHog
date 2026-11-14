// The countdown beeps' sound: a short sine tone for each tick, a longer and
// higher one for the go. Generated with Web Audio, so there is no file to ship
// and nothing to load. What to play, and when, is decided in
// @core/ride/countdown and src/renderer/src/runtime/beeps.ts.
import type { Beep } from '@core/ride/countdown'

const TONE: Record<Beep, { hz: number; seconds: number }> = {
  tick: { hz: 880, seconds: 0.12 },
  go: { hz: 1320, seconds: 0.45 },
}
/** Fade in and out over a few ms, so the tone starts and stops without a click. */
const ATTACK_S = 0.005

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  return ctx
}

/** Plays one beep at `volume` (0 to 1). Silent where there is no Web Audio. */
export function playBeep(beep: Beep, volume: number): void {
  if (volume <= 0) return
  const ac = context()
  if (!ac) return
  const { hz, seconds } = TONE[beep]
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(hz, t)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(Math.min(1, volume), t + ATTACK_S)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
  osc.connect(gain).connect(ac.destination)
  osc.start(t)
  osc.stop(t + seconds + ATTACK_S)
}

/**
 * Browsers start an audio context suspended until the page gets a click or a
 * key press. Mid-ride there may be none for a long time, so the context is
 * created and woken at the first one, before any beep is due.
 */
export function primeBeeps(): void {
  if (typeof window === 'undefined') return
  const wake = () => {
    window.removeEventListener('pointerdown', wake)
    window.removeEventListener('keydown', wake)
    context()
  }
  window.addEventListener('pointerdown', wake)
  window.addEventListener('keydown', wake)
}
