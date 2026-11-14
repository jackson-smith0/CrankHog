import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from '@tanstack/react-router'
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Bike, CalendarArrowDown, ChevronLeft, ChevronRight, CircleCheck, FlaskConical, Gauge, Mountain } from 'lucide-react'
import type { RideSummary } from '@core/ride/types'
import { dateKey, isDateKey } from '@core/workout/schedule'
import { db } from '../../db/db'
import { importFromIntervals } from '../../plan/intervals-import'
import { listScheduled, moveScheduled } from '../../plan/schedule-repo'
import { bridge } from '../../platform/bridge'
import { Button } from '../../ui/Button'
import { cn } from '../../ui/cn'
import { formatDurationShort } from '../../ui/format'
import { useNow } from '../../ui/useNow'
import { PlannedWorkoutDialog } from '../plan/PlannedWorkoutDialog'
import { calendarMonth, loadBand, shiftMonth, type CalendarDay, type PlannedOnDay } from './calendar'

const KIND_ICON = { free: Bike, workout: Gauge, route: Mountain, 'ftp-test': FlaskConical } as const
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
/** Day shading by load (TSS): nothing, light, solid, big day. The number is always shown too. */
const BAND = ['', 'bg-accent/5', 'bg-accent/10', 'bg-accent/20'] as const
const MAX_CHIPS = 3
const PLANNED_CHIP: Record<PlannedOnDay['status'], string> = {
  planned: 'border-dashed border-line-strong text-ink-dim',
  today: 'border-accent bg-accent/10 text-ink',
  missed: 'border-dashed border-line text-ink-faint line-through',
}

/**
 * A month at a time: each day's rides as chips, shaded by the day's load, with
 * week and month totals, and the workouts planned for each day. Drag a planned
 * workout to another day to move it, or click it to ride, move or remove it.
 * `planning` adds the intervals.icu import.
 */
export function RideCalendar({ planning = false }: { planning?: boolean }) {
  const [[year, month], setMonth] = useState<[number, number]>(() => {
    const d = new Date()
    return [d.getFullYear(), d.getMonth()]
  })
  const navigate = useNavigate()
  const [open, setOpen] = useState<PlannedOnDay | null>(null)
  // the grid reaches a few days into the months either side
  const from = new Date(year, month, -7).getTime()
  const to = new Date(year, month + 1, 8).getTime()
  const rides = useLiveQuery(() => db().rides.where('startedAt').between(from, to).toArray(), [from, to])
  const schedule = useLiveQuery(() => listScheduled(dateKey(from), dateKey(to)), [from, to])
  const nowMs = useNow()
  const m = calendarMonth(year, month, rides ?? [], nowMs, schedule ?? [])
  const now = new Date()
  const isThisMonth = year === now.getFullYear() && month === now.getMonth()

  // a small move first, so a click on a chip still opens it
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))
  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id
    const p = e.active.data.current as PlannedOnDay | undefined
    if (typeof to === 'string' && isDateKey(to) && p && p.entry.date !== to) void moveScheduled(p.entry.id, to)
  }

  return (
    <div className="rounded-2xl border border-line bg-panel" data-testid="ride-calendar">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-1">
          <Button size="iconSm" variant="ghost" onClick={() => setMonth(shiftMonth(year, month, -1))} aria-label="Previous month" data-testid="calendar-prev">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-44 text-center font-display text-lg font-semibold" data-testid="calendar-month">
            {MONTH.format(new Date(year, month, 1))}
          </h2>
          <Button size="iconSm" variant="ghost" onClick={() => setMonth(shiftMonth(year, month, 1))} aria-label="Next month" data-testid="calendar-next">
            <ChevronRight className="size-4" />
          </Button>
          {!isThisMonth && (
            <Button size="sm" variant="ghost" onClick={() => setMonth([now.getFullYear(), now.getMonth()])}>
              Today
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="tabular text-sm text-ink-dim" data-testid="calendar-summary">
            {m.rides} ride{m.rides === 1 ? '' : 's'} · {formatDurationShort(m.movingS)} · {Math.round(m.tss)} TSS
            {m.planned > 0 && ` · ${m.planned} planned`}
          </div>
          {planning && <IntervalsImport />}
        </div>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_88px]" role="grid" aria-label={`Rides in ${MONTH.format(new Date(year, month, 1))}`}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="eyebrow border-b border-line px-2 py-1.5 text-ink-faint" role="columnheader">
              {d}
            </div>
          ))}
          <div className="eyebrow border-b border-l border-line px-2 py-1.5 text-right text-ink-faint" role="columnheader">
            Week
          </div>
          {m.weeks.map((w) => (
            <div key={w.days[0]!.date} className="contents" role="row">
              {w.days.map((d) => (
                <DayCell key={d.date} day={d} onRide={(r) => void navigate({ to: '/history/$rideId', params: { rideId: r.id } })} onPlanned={setOpen} />
              ))}
              <div className="border-b border-l border-line p-2 text-right text-xs tabular text-ink-dim" role="gridcell">
                {w.rides > 0 ? (
                  <>
                    <div className="font-display text-sm font-semibold text-ink">{Math.round(w.tss)}</div>
                    <div>TSS</div>
                    <div className="mt-1">{formatDurationShort(w.movingS)}</div>
                  </>
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </DndContext>
      {open && <PlannedWorkoutDialog entry={open.entry} status={open.status} onClose={() => setOpen(null)} />}
    </div>
  )
}

function DayCell({ day: d, onRide, onPlanned }: { day: CalendarDay; onRide: (r: RideSummary) => void; onPlanned: (p: PlannedOnDay) => void }) {
  const key = dateKey(d.date)
  const { setNodeRef, isOver } = useDroppable({ id: key })
  const chips = d.planned.length + d.rides.length
  const plannedRides = new Set(d.plannedRideIds)
  const parts = [d.rides.length === 0 ? 'no rides' : `${d.rides.length} ride${d.rides.length === 1 ? '' : 's'}, ${Math.round(d.tss)} TSS`]
  if (d.planned.length > 0) parts.push(`${d.planned.length} planned`)
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={`${DAY.format(d.date)}: ${parts.join(', ')}`}
      className={cn('min-h-24 border-b border-r border-line p-1.5 last-of-type:border-r-0', BAND[loadBand(d.tss)], !d.inMonth && 'opacity-45', isOver && 'outline-2 -outline-offset-2 outline-accent')}
      data-testid={d.rides.length > 0 ? 'calendar-ride-day' : undefined}
      data-date={key}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className={cn('grid size-6 place-items-center rounded-full text-xs tabular', d.isToday ? 'bg-accent font-bold text-on-accent' : 'text-ink-dim')}>{d.day}</span>
        {d.tss > 0 && <span className="tabular text-[10px] text-ink-faint">{Math.round(d.tss)} TSS</span>}
      </div>
      <div className="space-y-1">
        {d.rides.slice(0, MAX_CHIPS).map((r) => {
          const Icon = plannedRides.has(r.id) ? CircleCheck : KIND_ICON[r.kind]
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onRide(r)}
              title={`${r.name} · ${formatDurationShort(r.movingS)}${r.tss !== null ? ` · ${Math.round(r.tss)} TSS` : ''}${plannedRides.has(r.id) ? ' · done, as planned' : ''}`}
              className="no-drag flex w-full items-center gap-1 rounded-md border border-line bg-panel-2 px-1.5 py-1 text-left text-[11px] leading-tight hover:border-accent"
              data-testid="calendar-ride"
            >
              <Icon className={cn('size-3 shrink-0', plannedRides.has(r.id) ? 'text-good' : 'text-accent')} aria-label={plannedRides.has(r.id) ? 'Done, as planned' : undefined} aria-hidden={!plannedRides.has(r.id)} />
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
            </button>
          )
        })}
        {d.planned.slice(0, Math.max(0, MAX_CHIPS - d.rides.length)).map((p) => (
          <PlannedChip key={p.entry.id} planned={p} onOpen={() => onPlanned(p)} />
        ))}
        {chips > MAX_CHIPS && <div className="px-1 text-[11px] text-ink-faint">+{chips - MAX_CHIPS} more</div>}
      </div>
    </div>
  )
}

function PlannedChip({ planned: p, onOpen }: { planned: PlannedOnDay; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: p.entry.id, data: p })
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      {...attributes}
      {...listeners}
      title={`${p.entry.name} · ${p.status === 'missed' ? 'missed' : 'planned'}. Drag to another day to move it.`}
      aria-label={`${p.entry.name}, ${p.status === 'missed' ? 'missed' : p.status === 'today' ? 'planned for today' : 'planned'}`}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn(
        'no-drag relative flex w-full touch-none items-center gap-1 rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight hover:border-accent',
        PLANNED_CHIP[p.status],
        isDragging && 'z-20 shadow-lg',
      )}
      data-testid="calendar-planned"
      data-status={p.status}
    >
      <Gauge className="size-3 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium">{p.entry.name}</span>
    </button>
  )
}

/** Brings planned rides from the rider's intervals.icu calendar onto this one (Mac app, with an API key set up). */
function IntervalsImport() {
  const [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  useEffect(() => {
    let live = true
    void bridge()
      .invoke('intervals.status', {})
      .then((s) => live && setConfigured(s.configured))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  if (!configured) return null
  const run = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const r = await importFromIntervals()
      const changed = r.added + r.updated
      setNotice({
        tone: 'good',
        text: changed === 0 && r.removed === 0 ? 'Nothing planned on intervals.icu for the next four weeks.' : `${changed} workout${changed === 1 ? '' : 's'} from intervals.icu${r.removed ? `, ${r.removed} removed` : ''}${r.skipped ? `. Skipped ${r.skipped} that aren't structured rides` : ''}.`,
      })
    } catch (e) {
      setNotice({ tone: 'bad', text: `Couldn't import from intervals.icu: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-2">
      {notice && (
        <span className={cn('text-xs', notice.tone === 'good' ? 'text-ink-dim' : 'text-bad')} role="status">
          {notice.text}
        </span>
      )}
      <Button size="sm" onClick={() => void run()} disabled={busy} data-testid="intervals-import" title="Last week and the next four weeks of planned rides">
        <CalendarArrowDown className="size-3.5" /> {busy ? 'Importing…' : 'Import from intervals.icu'}
      </Button>
    </div>
  )
}
