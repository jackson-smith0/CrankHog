import { useEffect, useState } from 'react'
import { Activity, ArrowRight, Bike, Footprints, Undo2, Waves, type LucideIcon } from 'lucide-react'
import type { EditParse, EditResolve } from '@core/ai/calendar-edits'
import { formatSportDistance } from '@core/sport/format'
import type { SportGroup } from '@core/sport/group'
import type { ChatEditState } from '../../ai/chat-history'
import { previewCoachEdit, resolveNow, type EditSide } from '../../plan/coach-edits'
import { useSettings } from '../../stores/settings'
import { Button } from '../../ui/Button'
import { cn } from '../../ui/cn'
import { formatDurationShort } from '../../ui/format'

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const dayText = (key: string) => DAY.format(new Date(`${key}T00:00:00`))

const SPORT_ICON: Record<SportGroup, LucideIcon> = { ride: Bike, run: Footprints, swim: Waves, other: Activity }

const TITLE = { change: 'Change', move: 'Move', add: 'Add', remove: 'Remove' } as const

/** What the card has worked out about a change: checked against the calendar, with before and after. */
type Look = { resolved: EditResolve; before: EditSide | null; after: EditSide | null }

export interface CoachEditCardProps {
  parse: EditParse
  state?: ChatEditState
  /** True while a reply is on its way: nothing can be pressed. */
  locked?: boolean
  /** Bumped by the page after any change is applied, so every card checks the calendar again. */
  calendarVersion: number
  onApply: (resolved: EditResolve & { ok: true }, shown: { before: EditSide | null; after: EditSide | null }) => Promise<void>
  onDismiss: () => void
  onUndo: () => Promise<void>
}

/** One calendar change the coach proposed: what it does, and Apply, Dismiss or Undo. */
export function CoachEditCard({ parse, state, locked = false, calendarVersion, onApply, onDismiss, onUndo }: CoachEditCardProps) {
  const [look, setLook] = useState<Look | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const busy = working || locked
  const settled = state?.status === 'applied' || state?.status === 'dismissed'

  // an applied change shows what it did, not the calendar it left behind
  const kept = state?.status === 'applied' ? state.shown : undefined

  useEffect(() => {
    if (!parse.ok || kept) return
    let live = true
    void (async () => {
      const resolved = await resolveNow(parse.edit)
      const sides = resolved.ok ? await previewCoachEdit(resolved) : { before: null, after: null }
      if (live) setLook({ resolved, ...sides })
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [parse, calendarVersion, kept])

  const act = async (fn: () => Promise<void>) => {
    setWorking(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  if (!parse.ok) {
    return (
      <Frame title="Change" testId="coach-edit-invalid">
        <p className="text-sm text-bad">The coach wrote a change CrankHog can't read: {parse.error}</p>
      </Frame>
    )
  }
  const edit = parse.edit
  const resolved = look?.resolved
  const sides = kept ?? look
  const problem = !settled && resolved && !resolved.ok ? resolved.problem : null
  const warnings = resolved?.ok ? resolved.warnings : []
  const ready = resolved?.ok && !settled

  return (
    <Frame title={TITLE[edit.action]} testId="coach-edit" status={state?.status}>
      {sides && (sides.before || sides.after) && (
        <div className="flex flex-col items-stretch gap-1.5 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          {sides.before && <Side side={sides.before} struck={edit.action === 'remove'} faded={edit.action !== 'remove'} />}
          {sides.before && sides.after && <ArrowRight className="size-4 shrink-0 self-center text-ink-faint max-sm:rotate-90" aria-label="becomes" />}
          {sides.after && <Side side={sides.after} />}
        </div>
      )}
      {edit.why && <p className="text-sm text-ink-dim">{edit.why}</p>}
      {edit.steps && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-dim hover:text-ink">Steps</summary>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-lg bg-panel-2 px-3 py-2 font-mono text-xs text-ink">{edit.steps}</pre>
        </details>
      )}
      {problem && <p className="text-sm text-bad">{problem}</p>}
      {warnings.map((w) => (
        <p key={w} className="text-sm text-warn">
          {w}
        </p>
      ))}
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        {state?.status === 'applied' ? (
          <>
            <span className="text-sm text-good">Applied</span>
            {state.undo && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(onUndo)}>
                <Undo2 className="size-3.5" /> Undo
              </Button>
            )}
          </>
        ) : state?.status === 'dismissed' ? (
          <span className="text-sm text-ink-faint">Dismissed</span>
        ) : (
          <>
            {state?.status === 'undone' && <span className="text-sm text-ink-faint">Undone.</span>}
            <Button size="sm" variant="primary" disabled={!ready || busy} onClick={() => resolved?.ok && look && void act(() => onApply(resolved, { before: look.before, after: look.after }))}>
              Apply
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </Frame>
  )
}

function Frame({ title, status, testId, children }: { title: string; status?: ChatEditState['status']; testId: string; children: React.ReactNode }) {
  return (
    <div className={cn('my-2 space-y-2 rounded-xl border bg-panel-2 px-3.5 py-3', status === 'applied' ? 'border-good/40' : 'border-line-strong')} data-testid={testId}>
      <div className="eyebrow text-ink-faint">{title} on the calendar</div>
      {children}
    </div>
  )
}

function Side({ side, struck, faded }: { side: EditSide; struck?: boolean; faded?: boolean }) {
  const units = useSettings((s) => s.units)
  const Icon = SPORT_ICON[side.sport]
  const stats = [
    side.durationS ? formatDurationShort(side.durationS) : null,
    side.distanceM ? formatSportDistance(side.distanceM, side.sport, units) : null,
    side.load !== null ? `${Math.round(side.load)} load` : null,
  ].filter((x): x is string => !!x)
  return (
    <span className={cn('flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border border-line bg-panel px-2.5 py-1.5', faded && 'text-ink-dim', struck && 'line-through')}>
      <Icon className="size-3.5 shrink-0" />
      <span className="whitespace-nowrap font-display tabular-nums">{dayText(side.date)}</span>
      <span className="min-w-0 truncate font-medium">{side.name}</span>
      {stats.length > 0 && <span className="whitespace-nowrap font-display text-xs tabular-nums text-ink-faint">{stats.join(' · ')}</span>}
    </span>
  )
}
