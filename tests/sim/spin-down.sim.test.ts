import { afterEach, describe, expect, it } from 'vitest'
import { SpinDown, type SpinDownState, type SpinDownTrainer } from '@core/control/spin-down'
import type { TrainerDriver } from '@core/devices/driver'
import { simRig } from './rig'

/** The connected trainer's driver, which must offer spin down. */
function spinDownTrainer(driver: TrainerDriver | null): SpinDownTrainer {
  expect(driver?.caps.spinDown).toBe(true)
  const d = driver as TrainerDriver & Partial<SpinDownTrainer>
  expect(d.startSpinDown).toBeTypeOf('function')
  return d as TrainerDriver & SpinDownTrainer
}

// Real FTMS bytes both ways: Spin Down Control, its response with the speed
// window, and the Spin Down Status indications.
describe('spin down on a simulated KICKR over FTMS', () => {
  let rig: ReturnType<typeof simRig>
  afterEach(() => {
    rig.engine.stop()
    rig.devices.disconnectAll()
    rig.world.stop()
  })

  async function calibrate() {
    rig = simRig()
    await rig.connect('trainer')
    const sd = new SpinDown(spinDownTrainer(rig.devices.trainer()), rig.clock)
    const phases: SpinDownState['phase'][] = []
    sd.subscribe((s) => phases.at(-1) !== s.phase && phases.push(s.phase))
    await rig.until(sd.start())
    return { sd, phases }
  }

  it('speed up into the window, stop pedalling, and the trainer reports success', async () => {
    const { sd, phases } = await calibrate()
    expect(sd.state).toEqual({ phase: 'speedUp', targets: { lowKmh: 30, highKmh: 35 } })
    expect(rig.world.trainer.commandLog.map((c) => c.op)).toContain('spinDown')

    rig.world.setBehavior({ kind: 'hold', watts: 450 })
    for (let s = 0; s < 90 && sd.state.phase === 'speedUp'; s++) await rig.advance(1000)
    expect(sd.state.phase).toBe('coast')

    rig.world.setBehavior({ kind: 'coast' })
    for (let s = 0; s < 60 && sd.state.phase === 'coast'; s++) await rig.advance(1000)
    expect(sd.state).toEqual({ phase: 'done' })
    expect(phases).toEqual(['idle', 'starting', 'speedUp', 'coast', 'done'])
  })

  it('pedalling through the coast makes the trainer report an error', async () => {
    const { sd } = await calibrate()
    rig.world.setBehavior({ kind: 'hold', watts: 450 })
    for (let s = 0; s < 90 && sd.state.phase === 'speedUp'; s++) await rig.advance(1000)
    expect(sd.state.phase).toBe('coast')
    // keeps pedalling
    await rig.advance(10_000)
    expect(sd.state).toEqual({ phase: 'failed', reason: 'trainer-error' })
  })

  it('a trainer without spin down says it is not supported', async () => {
    rig = simRig()
    rig.world.trainer.spinDownSupported = false
    await rig.connect('trainer')
    const driver = rig.devices.trainer() as TrainerDriver & SpinDownTrainer
    expect(driver.caps.spinDown).toBe(false)
    const sd = new SpinDown(driver, rig.clock)
    await rig.until(sd.start())
    expect(sd.state).toEqual({ phase: 'failed', reason: 'unsupported' })
  })
})
