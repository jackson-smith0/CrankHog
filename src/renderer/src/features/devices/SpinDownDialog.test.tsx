import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SpinDownStatus } from '@core/ble/codecs'
import { SpinDown, type SpinDownStart, type SpinDownTrainer } from '@core/control/spin-down'
import { FakeClock } from '@core/time/clock'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import { EMPTY_FRAME } from '@shared/live'
import { liveStore } from '../../stores/live'
import { rideStore } from '../../stores/ride'
import { settingsStore } from '../../stores/settings'
import { SpinDownDialog } from './SpinDownDialog'

class FakeTrainer implements SpinDownTrainer {
  private listeners = new Set<(s: SpinDownStatus) => void>()
  constructor(private readonly reply: SpinDownStart = { result: 'ok', targets: { lowKmh: 30, highKmh: 35 } }) {}
  async startSpinDown() {
    return this.reply
  }
  onSpinDownStatus(l: (s: SpinDownStatus) => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  send(s: SpinDownStatus) {
    act(() => this.listeners.forEach((l) => l(s)))
  }
}

function open(trainer: FakeTrainer, settings: Partial<AppSettings> = {}) {
  settingsStore.setState({ ...DEFAULT_SETTINGS, speedUnit: 'kmh', ...settings }, true)
  let closed = false
  render(<SpinDownDialog open onOpenChange={(o) => (closed = !o)} create={() => new SpinDown(trainer, new FakeClock())} />)
  return { closed: () => closed }
}

const start = async () => {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start' })))
}

describe('SpinDownDialog', () => {
  afterEach(() => {
    cleanup()
    liveStore.setState(EMPTY_FRAME, true)
    rideStore.setState({ active: false })
  })

  it('walks the rider through speeding up, coasting, and the result', async () => {
    const trainer = new FakeTrainer()
    open(trainer)
    expect(screen.getByText(/warm up for 10 minutes/i)).toBeTruthy()
    await start()
    expect(screen.getByTestId('spin-down-step').textContent).toBe('Speed up to 35 km/h')
    act(() => liveStore.setState({ ...EMPTY_FRAME, speedKmh: 28.4 }))
    expect(screen.getByTestId('spin-down-speed').textContent).toBe('28.4')
    trainer.send('stopPedaling')
    expect(screen.getByTestId('spin-down-step').textContent).toBe('Stop pedalling')
    trainer.send('success')
    expect(screen.getByTestId('spin-down-step').textContent).toBe('Calibrated')
  })

  it('shows the speed window in the rider’s units', async () => {
    open(new FakeTrainer(), { speedUnit: 'mph' })
    await start()
    expect(screen.getByTestId('spin-down-step').textContent).toBe('Speed up to 21.7 mph')
  })

  it('explains a failure and offers another go', async () => {
    const trainer = new FakeTrainer()
    open(trainer)
    await start()
    trainer.send('stopPedaling')
    trainer.send('error')
    expect(screen.getByTestId('spin-down-step').textContent).toBe('That didn’t work')
    expect(screen.getByText(/keep your legs still/i)).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
    expect(screen.getByTestId('spin-down-step').textContent).toBe('Speed up to 35 km/h')
  })

  it('says when another app holds the trainer', async () => {
    open(new FakeTrainer({ result: 'not-permitted', targets: null }))
    await start()
    expect(screen.getByText(/another app/i)).toBeTruthy()
  })

  it('will not start during a ride', () => {
    rideStore.setState({ active: true })
    open(new FakeTrainer())
    expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/finish your ride first/i)).toBeTruthy()
  })
})
