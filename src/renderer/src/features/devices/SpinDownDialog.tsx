import { useEffect, useRef, useState } from 'react'
import type { SpinDown, SpinDownFailure, SpinDownState } from '@core/control/spin-down'
import { formatSpeedKmh, speedUnit } from '@core/units'
import { useLive } from '../../stores/live'
import { useRide } from '../../stores/ride'
import { useSettings } from '../../stores/settings'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'

const FAILURE: Record<SpinDownFailure, string> = {
  unsupported: 'This trainer has no spin-down calibration. Many direct-drive trainers calibrate themselves.',
  'not-permitted': 'Another app (Zwift, the Wahoo app or a head unit) has control of the trainer. Close it, then try again.',
  rejected: 'The trainer refused to start a spin-down. Stop pedalling, wait for the flywheel to stop, then try again.',
  'no-answer': 'The trainer did not answer. Check that it is still connected, then try again.',
  'trainer-error': 'The trainer could not measure the coast-down. Once it asks you to stop pedalling, keep your legs still until it finishes.',
  timeout: 'The trainer never finished. Speed up a little past the target, then stop pedalling completely.',
  disconnected: 'The trainer disconnected. Wait for it to reconnect, then try again.',
}

/**
 * Spin-down calibration, step by step: warm up, speed up into the trainer's
 * window, stop pedalling and let the flywheel coast, then the result.
 * `create` gives a fresh calibration for the connected trainer.
 */
export function SpinDownDialog({ open, onOpenChange, create }: { open: boolean; onOpenChange: (open: boolean) => void; create: () => SpinDown | null }) {
  const [state, setState] = useState<SpinDownState>({ phase: 'idle' })
  const run = useRef<{ sd: SpinDown; off: () => void } | null>(null)
  const riding = useRide((s) => s.active)
  // the free-ride screen drives the trainer without recording
  const driven = useLive((f) => f.trainer.mode !== 'idle')
  const busy = riding || driven

  const stop = () => {
    run.current?.off()
    run.current?.sd.cancel()
    run.current = null
    setState({ phase: 'idle' })
  }
  useEffect(() => () => stop(), [])

  const start = async () => {
    stop()
    const sd = create()
    if (!sd) return setState({ phase: 'failed', reason: 'unsupported' })
    run.current = { sd, off: sd.subscribe(setState) }
    await sd.start()
  }

  const close = (o: boolean) => {
    if (!o) stop()
    onOpenChange(o)
  }

  const running = state.phase === 'starting' || state.phase === 'speedUp' || state.phase === 'coast'
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Calibrate trainer"
      description="A spin-down measures how your trainer's flywheel slows down, so its power readings stay accurate."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {running ? 'Cancel' : 'Close'}
          </Button>
          {state.phase === 'idle' && (
            <Button variant="primary" onClick={() => void start()} disabled={busy}>
              Start
            </Button>
          )}
          {state.phase === 'failed' && state.reason !== 'unsupported' && (
            <Button variant="primary" onClick={() => void start()} disabled={busy}>
              Try again
            </Button>
          )}
        </>
      }
    >
      <div className="min-h-40" data-testid="spin-down">
        <Step state={state} busy={busy} />
      </div>
    </Dialog>
  )
}

function Step({ state, busy }: { state: SpinDownState; busy: boolean }) {
  switch (state.phase) {
    case 'idle':
      return (
        <div className="space-y-2 text-sm">
          <p>Warm up for 10 minutes first: a cold trainer reads differently. Then press Start, speed up to the speed it asks for, and stop pedalling when it says so.</p>
          <p className="text-ink-dim">Wheel-on trainers need this after every change of tyre pressure.</p>
          {busy && <p className="text-bad">Finish your ride first. The trainer can't be calibrated while it is holding a target.</p>}
        </div>
      )
    case 'starting':
      return <Heading>Asking the trainer…</Heading>
    case 'speedUp':
      return <SpeedUp targetKmh={state.targets?.highKmh ?? null} />
    case 'coast':
      return (
        <div className="space-y-2">
          <Heading>Stop pedalling</Heading>
          <p className="text-sm text-ink-dim">Keep your legs still and let the flywheel coast. The trainer is measuring.</p>
        </div>
      )
    case 'done':
      return (
        <div className="space-y-2">
          <Heading>Calibrated</Heading>
          <p className="text-sm text-ink-dim">The trainer has saved the result. Power readings now account for it.</p>
        </div>
      )
    case 'failed':
      return (
        <div className="space-y-2">
          <Heading>That didn’t work</Heading>
          <p className="text-sm text-ink-dim">{FAILURE[state.reason]}</p>
        </div>
      )
  }
}

function SpeedUp({ targetKmh }: { targetKmh: number | null }) {
  const units = useSettings((s) => s.speedUnit)
  const kmh = useLive((f) => f.speedKmh)
  const unit = speedUnit(units)
  const pct = targetKmh && kmh !== null ? Math.min(100, (kmh / targetKmh) * 100) : 0
  return (
    <div className="space-y-3">
      <Heading>{targetKmh === null ? 'Speed up' : `Speed up to ${formatSpeedKmh(targetKmh, units)} ${unit}`}</Heading>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-5xl font-semibold tabular" data-testid="spin-down-speed">
          {formatSpeedKmh(kmh, units) ?? '—'}
        </span>
        <span className="eyebrow text-ink-faint">{unit}</span>
      </div>
      {targetKmh !== null && (
        <div className="h-2 rounded-full bg-panel-3" aria-hidden>
          <div className="h-2 rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-sm text-ink-dim">{targetKmh === null ? 'Keep going until the trainer tells you to stop.' : 'Go a little past it. The trainer tells you when to stop.'}</p>
    </div>
  )
}

function Heading({ children }: { children: string }) {
  return (
    <h3 className="font-display text-2xl font-semibold" data-testid="spin-down-step">
      {children}
    </h3>
  )
}
