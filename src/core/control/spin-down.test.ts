import { describe, expect, it } from 'vitest'
import type { SpinDownStatus } from '../ble/codecs'
import { FakeClock } from '../time/clock'
import { SpinDown, type SpinDownStart, type SpinDownState, type SpinDownTrainer } from './spin-down'

/** A trainer the test answers by hand: how it replies to Start, and the statuses it sends afterwards. */
class FakeTrainer implements SpinDownTrainer {
  starts = 0
  private listeners = new Set<(s: SpinDownStatus) => void>()
  constructor(private readonly reply: SpinDownStart = { result: 'ok', targets: { lowKmh: 30, highKmh: 35 } }) {}
  async startSpinDown(): Promise<SpinDownStart> {
    this.starts++
    return this.reply
  }
  onSpinDownStatus(l: (s: SpinDownStatus) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  send(s: SpinDownStatus): void {
    for (const l of this.listeners) l(s)
  }
  get listening(): number {
    return this.listeners.size
  }
}

async function started(trainer: FakeTrainer, clock = new FakeClock()) {
  const sd = new SpinDown(trainer, clock)
  const seen: SpinDownState[] = []
  sd.subscribe((s) => seen.push(s))
  await sd.start()
  return { sd, seen, clock }
}

describe('SpinDown', () => {
  it('asks for the speed window, then to coast, then reports the calibration done', async () => {
    const trainer = new FakeTrainer()
    const { sd, seen } = await started(trainer)
    trainer.send('stopPedaling')
    trainer.send('success')
    expect(seen).toEqual([
      { phase: 'idle' },
      { phase: 'starting' },
      { phase: 'speedUp', targets: { lowKmh: 30, highKmh: 35 } },
      { phase: 'coast' },
      { phase: 'done' },
    ])
    expect(sd.state).toEqual({ phase: 'done' })
    expect(trainer.listening).toBe(0)
  })

  it('still runs on a trainer that gives no speed window', async () => {
    const { sd } = await started(new FakeTrainer({ result: 'ok', targets: null }))
    expect(sd.state).toEqual({ phase: 'speedUp', targets: null })
  })

  it('fails with the trainer’s refusal when the trainer will not start one', async () => {
    expect((await started(new FakeTrainer({ result: 'unsupported', targets: null }))).sd.state).toEqual({ phase: 'failed', reason: 'unsupported' })
    expect((await started(new FakeTrainer({ result: 'not-permitted', targets: null }))).sd.state).toEqual({ phase: 'failed', reason: 'not-permitted' })
    expect((await started(new FakeTrainer({ result: 'timeout', targets: null }))).sd.state).toEqual({ phase: 'failed', reason: 'no-answer' })
  })

  it('fails when the trainer reports an error, for example after pedalling during the coast', async () => {
    const trainer = new FakeTrainer()
    const { sd } = await started(trainer)
    trainer.send('stopPedaling')
    trainer.send('error')
    expect(sd.state).toEqual({ phase: 'failed', reason: 'trainer-error' })
  })

  it('gives up when the rider never reaches the speed', async () => {
    const { sd, clock } = await started(new FakeTrainer())
    clock.advance(89_000)
    expect(sd.state.phase).toBe('speedUp')
    clock.advance(1_000)
    expect(sd.state).toEqual({ phase: 'failed', reason: 'timeout' })
  })

  it('gives up when the trainer never finishes the coast', async () => {
    const trainer = new FakeTrainer()
    const { sd, clock } = await started(trainer)
    clock.advance(80_000)
    trainer.send('stopPedaling')
    // the coast gets its own minute, not what was left of the speed-up
    clock.advance(59_000)
    expect(sd.state.phase).toBe('coast')
    clock.advance(1_000)
    expect(sd.state).toEqual({ phase: 'failed', reason: 'timeout' })
  })

  it('fails when the trainer drops off', async () => {
    const { sd } = await started(new FakeTrainer())
    sd.lost()
    expect(sd.state).toEqual({ phase: 'failed', reason: 'disconnected' })
  })

  it('stops listening, and ignores late statuses, once cancelled', async () => {
    const trainer = new FakeTrainer()
    const { sd, clock } = await started(trainer)
    sd.cancel()
    trainer.send('success')
    clock.advance(120_000)
    expect(sd.state).toEqual({ phase: 'idle' })
    expect(trainer.listening).toBe(0)
  })

  it('can run again after it finished', async () => {
    const trainer = new FakeTrainer()
    const { sd } = await started(trainer)
    trainer.send('error')
    await sd.start()
    expect(sd.state.phase).toBe('speedUp')
    expect(trainer.starts).toBe(2)
  })
})
