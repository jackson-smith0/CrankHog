import { afterEach, describe, expect, it, vi } from 'vitest'

/** Records the tones a page would make: each oscillator's pitch and length, and each gain node's peak. */
class FakeAudioContext {
  static made: FakeAudioContext[] = []
  state: 'suspended' | 'running' = 'suspended'
  currentTime = 10
  destination = {}
  oscillators: { hz: number; startAt: number; stopAt: number }[] = []
  gains: { peak: number }[] = []
  constructor() {
    FakeAudioContext.made.push(this)
  }
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  createOscillator() {
    const o = { hz: 0, startAt: NaN, stopAt: NaN }
    this.oscillators.push(o)
    return {
      type: 'sine',
      frequency: { setValueAtTime: (v: number) => (o.hz = v) },
      connect: (n: unknown) => n,
      start: (t: number) => (o.startAt = t),
      stop: (t: number) => (o.stopAt = t),
    }
  }
  createGain() {
    const g = { peak: 0 }
    this.gains.push(g)
    const track = (v: number) => (g.peak = Math.max(g.peak, v))
    return {
      gain: { setValueAtTime: track, linearRampToValueAtTime: track, exponentialRampToValueAtTime: track },
      connect: (n: unknown) => n,
    }
  }
  /** One oscillator and one gain per beep, in order. */
  get tones() {
    return this.oscillators.map((o, i) => ({ ...o, peak: this.gains[i]!.peak }))
  }
}

const load = async () => {
  vi.resetModules()
  FakeAudioContext.made = []
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return import('./beeps')
}

describe('playBeep', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sounds the go longer and higher than a tick, as loud as asked', async () => {
    const { playBeep } = await load()
    playBeep('tick', 0.5)
    playBeep('go', 0.5)
    const [tick, go] = FakeAudioContext.made[0]!.tones
    expect(go!.hz).toBeGreaterThan(tick!.hz)
    expect(go!.stopAt - go!.startAt).toBeGreaterThan(tick!.stopAt - tick!.startAt)
    expect(tick!.peak).toBeCloseTo(0.5)
    expect(go!.peak).toBeCloseTo(0.5)
  })

  it('makes no sound, and no audio context, at volume 0', async () => {
    const { playBeep } = await load()
    playBeep('go', 0)
    expect(FakeAudioContext.made).toHaveLength(0)
  })

  it('wakes a suspended audio context at the first click, so the first beep is heard', async () => {
    const { primeBeeps } = await load()
    primeBeeps()
    expect(FakeAudioContext.made).toHaveLength(0)
    window.dispatchEvent(new Event('pointerdown'))
    expect(FakeAudioContext.made[0]!.resume).toHaveBeenCalled()
  })

  it('does nothing where the browser has no Web Audio', async () => {
    vi.resetModules()
    vi.stubGlobal('AudioContext', undefined)
    const { playBeep } = await import('./beeps')
    expect(() => playBeep('tick', 1)).not.toThrow()
  })
})
