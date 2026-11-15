import { afterEach, describe, expect, it } from 'vitest'
import { encodeFtmsCommand } from '@core/ble/codecs'
import { CHAR, SERVICE } from '@core/ble/uuids'
import { Calibrator } from '@core/control/calibrator'
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

  /** Asks for 200 W in ERG the way a ride does (no soft start), and lets the controller send it. */
  async function erg() {
    rig.controller.updateSettings({ ergSoftStartS: 0 })
    rig.controller.setDesired({ mode: 'erg', watts: 200 })
    rig.world.setBehavior({ kind: 'hold', watts: 200 })
    await rig.advance(3000)
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

  it('a trainer left in its spin down refuses the next target', async () => {
    const { sd } = await calibrate()
    expect(sd.state.phase).toBe('speedUp')
    const result = await rig.until(rig.devices.trainer()!.send({ kind: 'erg', watts: 200 }))
    expect(result).toBe('rejected')
    expect(rig.world.trainer.mode).toBe('none')
  })

  it('cancelling stops the spin down on the trainer, and ERG takes again', async () => {
    const { sd } = await calibrate()
    rig.world.trainer.commandLog.length = 0
    sd.cancel()
    await rig.advance(500)
    expect(rig.world.trainer.spinningDown).toBe(false)
    await erg()
    expect(rig.world.trainer.mode).toBe('erg')
    expect(rig.world.trainer.targetW).toBe(200)
    // Stop ends the session, so Start goes out again before the target
    expect(rig.world.trainer.commandLog.map((c) => c.op).slice(0, 3)).toEqual(['stop', 'start', 'targetPower'])
  })

  it('giving up on a rider who never reaches the speed stops the spin down too', async () => {
    const { sd } = await calibrate()
    rig.world.setBehavior({ kind: 'hold', watts: 80 })
    await rig.advance(91_000, 250)
    expect(sd.state).toEqual({ phase: 'failed', reason: 'timeout' })
    expect(rig.world.trainer.spinningDown).toBe(false)
    await erg()
    expect(rig.world.trainer.mode).toBe('erg')
  })

  it('fails at once, without waiting out the timeout, when another app takes the trainer', async () => {
    const { sd } = await calibrate()
    rig.world.trainer.stealControl()
    await rig.advance(100)
    expect(sd.state).toEqual({ phase: 'failed', reason: 'control-lost' })
  })

  it('fails at once when the trainer resets', async () => {
    const { sd } = await calibrate()
    rig.world.trainer.resetByTrainer()
    await rig.advance(100)
    expect(sd.state).toEqual({ phase: 'failed', reason: 'trainer-reset' })
    // the next target takes control again
    await erg()
    expect(rig.world.trainer.mode).toBe('erg')
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

describe('the calibrator on a simulated KICKR', () => {
  let rig: ReturnType<typeof simRig>
  afterEach(() => {
    rig.engine.stop()
    rig.devices.disconnectAll()
    rig.world.stop()
  })

  async function setup(opts: { riding?: boolean } = {}) {
    rig = simRig()
    const seen = { released: 0, ended: 0, requested: 0 }
    const calibrator = new Calibrator({
      devices: rig.devices,
      clock: rig.clock,
      riding: () => opts.riding ?? false,
      release: () => seen.released++,
      ended: () => seen.ended++,
      requested: () => seen.requested++,
    })
    await rig.connect('trainer')
    return { calibrator, seen }
  }

  async function running(calibrator: Calibrator) {
    const sd = calibrator.create()
    if (typeof sd === 'string') throw new Error(sd)
    await rig.until(sd.start())
    expect(sd.state.phase).toBe('speedUp')
    expect(calibrator.running).toBe(true)
    return sd
  }

  it('ends the calibration at once when the trainer drops off, and says so while it reconnects', async () => {
    const { calibrator, seen } = await setup()
    const sd = await running(calibrator)
    rig.world.trainer.drop(5000)
    await rig.advance(100)
    expect(sd.state).toEqual({ phase: 'failed', reason: 'disconnected' })
    expect(calibrator.running).toBe(false)
    expect(seen.ended).toBe(1)
    // Try again while it reconnects
    expect(calibrator.create()).toBe('disconnected')
  })

  it('ends the calibration at once on Disconnect or Forget, which emit no drop', async () => {
    const { calibrator } = await setup()
    const sd = await running(calibrator)
    rig.devices.disconnect('trainer')
    expect(sd.state).toEqual({ phase: 'failed', reason: 'disconnected' })
  })

  it('ends the calibration at once when another trainer connects in its place', async () => {
    const { calibrator } = await setup()
    const sd = await running(calibrator)
    await rig.connect('trainer')
    expect(sd.state).toEqual({ phase: 'failed', reason: 'disconnected' })
    // and the new trainer can be calibrated
    await running(calibrator)
  })

  it('will not start a calibration while a ride is recording', async () => {
    const { calibrator, seen } = await setup({ riding: true })
    const sd = calibrator.create()
    if (typeof sd === 'string') throw new Error(sd)
    await rig.until(sd.start())
    expect(sd.state).toEqual({ phase: 'failed', reason: 'busy' })
    expect(rig.world.trainer.commandLog.map((c) => c.op)).not.toContain('spinDown')
    // a ride's target is not let go of
    expect(seen.released).toBe(0)
  })

  it('lets go of a target held with no ride recording before calibrating', async () => {
    const { calibrator, seen } = await setup()
    await running(calibrator)
    expect(seen.released).toBe(1)
  })

  it('says a trainer without spin down has none', async () => {
    rig = simRig()
    rig.world.trainer.spinDownSupported = false
    const calibrator = new Calibrator({ devices: rig.devices, clock: rig.clock, riding: () => false, release: () => undefined, ended: () => undefined, requested: () => undefined })
    await rig.connect('trainer')
    expect(calibrator.create()).toBe('unsupported')
  })

  it("passes on the trainer's request for a spin down once, and never while one runs", async () => {
    const { calibrator, seen } = await setup()
    const sd = await running(calibrator)
    rig.world.trainer.requestSpinDown()
    await rig.advance(100)
    expect(seen.requested).toBe(0)
    sd.cancel()
    rig.world.trainer.requestSpinDown()
    rig.world.trainer.requestSpinDown()
    await rig.advance(100)
    expect(seen.requested).toBe(1)
    // and after a reconnect, still once
    rig.world.trainer.drop(0)
    await rig.advance(3000)
    expect(rig.devices.get('trainer')?.state).toBe('connected')
    rig.world.trainer.requestSpinDown()
    await rig.advance(100)
    expect(seen.requested).toBe(1)
  })

  it('declining with Ignore clears the request but leaves a running spin down alone', async () => {
    const { calibrator } = await setup()
    rig.world.trainer.requestSpinDown()
    await rig.advance(100)
    expect(rig.world.trainer.spinDownRequested).toBe(true)
    await running(calibrator)
    expect(rig.world.trainer.spinDownRequested).toBe(false)
    // a client that ignores it while one runs
    rig.world.trainer.requestSpinDown()
    rig.world.trainer.gattWrite(SERVICE.fitnessMachine, CHAR.fitnessMachineControlPoint, encodeFtmsCommand({ op: 'spinDown', start: false }))
    await rig.advance(100)
    expect(rig.world.trainer.spinDownRequested).toBe(false)
    expect(rig.world.trainer.spinningDown).toBe(true)
  })
})
