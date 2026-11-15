import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Play, Trash2 } from 'lucide-react'
import { formatSportDistance } from '@core/sport/format'
import { SPORT_GROUP_LABEL } from '@core/sport/group'
import { EFFORT_LABEL } from '@core/sport/load'
import { dateKeyToMs, entrySport, isBikeWorkout, isDateKey, type ScheduleStatus, type ScheduledWorkout } from '@core/workout/schedule'
import { moveScheduled, removeScheduled } from '../../plan/schedule-repo'
import { useRide } from '../../stores/ride'
import { useSettings } from '../../stores/settings'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field, Input } from '../../ui/form'
import { formatDurationShort } from '../../ui/format'
import { getWorkout } from '../../workouts/library'
import { startWorkout } from '../workouts/start'

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const STATUS: Record<Exclude<ScheduleStatus, 'done'>, string> = { planned: 'Planned', today: 'Planned for today', missed: 'Missed' }

/** What a planned session of another sport is: its sport, time, distance, how hard, notes. */
function SessionDetails({ entry }: { entry: ScheduledWorkout }) {
  const units = useSettings((s) => s.units)
  const sport = entrySport(entry)
  const s = entry.session ?? {}
  const rows: [string, string][] = [
    ['Sport', s.label ? `${SPORT_GROUP_LABEL[sport]}: ${s.label}` : SPORT_GROUP_LABEL[sport]],
    ...(s.durationS ? [['Time', formatDurationShort(s.durationS)] as [string, string]] : []),
    ...(s.distanceM ? [['Distance', formatSportDistance(s.distanceM, sport, units)] as [string, string]] : []),
    ...(s.effort ? [['How hard', EFFORT_LABEL[s.effort]] as [string, string]] : []),
    ...(typeof s.load === 'number' ? [['Planned load', `${Math.round(s.load)} TSS`] as [string, string]] : []),
    ...(s.notes ? [['Notes', s.notes] as [string, string]] : []),
  ]
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-testid="planned-session-details">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-dim">{k}</dt>
          <dd className="tabular">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A planned workout from the calendar: ride it, move it to another day, or take it off. A session of another sport can't be ridden; it is done when an activity of that sport lands on its day. */
export function PlannedWorkoutDialog({ entry, status, planName, onClose }: { entry: ScheduledWorkout; status: Exclude<ScheduleStatus, 'done'>; planName?: string; onClose: () => void }) {
  const navigate = useNavigate()
  const riding = useRide((s) => s.active)
  const bike = isBikeWorkout(entry)
  const [date, setDate] = useState(entry.date)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const ride = () =>
    act(async () => {
      const workout = entry.workout ?? (entry.workoutId ? await getWorkout(entry.workoutId) : null)
      if (!workout) throw new Error('That workout is no longer in your library.')
      await startWorkout(workout)
      onClose()
      await navigate({ to: '/ride' })
    })

  const move = () =>
    act(async () => {
      if (!isDateKey(date)) throw new Error('Pick a day.')
      await moveScheduled(entry.id, date)
      onClose()
    })

  const remove = () =>
    act(async () => {
      await removeScheduled(entry.id)
      onClose()
    })

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={entry.name}
      description={`${STATUS[status]}: ${DAY.format(dateKeyToMs(entry.date))}${planName ? `, from ${planName}` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => void remove()} disabled={busy} data-testid="planned-remove">
            <Trash2 className="size-3.5" /> Remove
          </Button>
          {bike && (
            <Button variant="primary" onClick={() => void ride()} disabled={busy || riding} data-testid="planned-ride">
              <Play className="size-3.5" /> Ride it now
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {!bike && <SessionDetails entry={entry} />}
        <Field label="Move to">
          <div className="flex gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Move to day" className="max-w-48" data-testid="planned-date" />
            <Button onClick={() => void move()} disabled={busy || date === entry.date} data-testid="planned-move">
              Move
            </Button>
          </div>
        </Field>
        {entry.source === 'intervals' && <p className="text-xs text-ink-faint">From your intervals.icu calendar. The next import brings back what is planned there, so move or delete it there to keep the change.</p>}
        {entry.planId && <p className="text-xs text-ink-faint">Moved or removed, it stays that way when the plan changes. The plan keeps it, and can put it back on its own day.</p>}
        {!bike && <p className="text-xs text-ink-faint">It turns green once a {SPORT_GROUP_LABEL[entrySport(entry)].toLowerCase()} lands on its day: from a FIT file, from intervals.icu, or logged by hand.</p>}
        {bike && riding && <p className="text-xs text-ink-dim">Finish the ride in progress to start this one.</p>}
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </Dialog>
  )
}
