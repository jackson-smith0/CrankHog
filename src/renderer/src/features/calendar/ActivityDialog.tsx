import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { formatSportDistance } from '@core/sport/format'
import { activityGroup, SPORT_GROUP_LABEL } from '@core/sport/group'
import { EFFORT_LABEL, activityLoad, effortLoad } from '@core/sport/load'
import { dateKey } from '@core/workout/schedule'
import type { OtherActivity } from '../../db/db'
import { removeActivity, removeWarning, updateManualActivity } from '../../plan/activities-repo'
import { useSettings } from '../../stores/settings'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { formatDurationShort } from '../../ui/format'
import { SessionFields } from './SessionFields'
import { readDraft, type SessionDraft } from './session-draft'
import { sportLabel } from './sport'

const WHEN = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

const SOURCE: Record<NonNullable<OtherActivity['source']>, string> = { fit: 'A FIT file', intervals: 'intervals.icu', manual: 'Entered by hand' }

/** The load line: the number and where it came from. */
function loadText(a: OtherActivity): string {
  if (a.hrLoad !== null && a.hrLoad !== undefined) return `${Math.round(a.hrLoad)} hrTSS`
  if (typeof a.icuLoad === 'number') return `${Math.round(a.icuLoad)} TSS, from intervals.icu`
  if (typeof a.manualLoad === 'number') return `${Math.round(a.manualLoad)} TSS${a.effort ? `, ${EFFORT_LABEL[a.effort].toLowerCase()}` : ''}`
  if (a.source === 'manual') return 'None: pick how hard it was, or give a load'
  return 'No heart rate, or no threshold heart rate in Settings → Athlete & FTP'
}

const draftOf = (a: OtherActivity, units: 'metric' | 'imperial'): SessionDraft => ({
  group: activityGroup(a),
  label: a.label ?? '',
  time: String(Math.round(a.movingS / 60)),
  distance: a.distanceM ? formatSportDistance(a.distanceM, activityGroup(a), units) : '',
  effort: a.effort ?? 'moderate',
  // a load the rider typed is one that isn't what the effort gives for that time
  load: typeof a.manualLoad === 'number' && a.manualLoad !== effortLoad(a.movingS, a.effort) ? String(a.manualLoad) : '',
  notes: a.notes ?? '',
})

/** An activity that isn't a ride in the history: what it was, its load, and where it came from. One entered by hand can be edited. */
export function ActivityDialog({ activity: a, onClose }: { activity: OtherActivity; onClose: () => void }) {
  const units = useSettings((s) => s.units)
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SessionDraft>(() => draftOf(a, units))
  const [error, setError] = useState<string | null>(null)
  const group = activityGroup(a)
  const manual = a.source === 'manual'
  const rows: [string, string][] = [
    ['Sport', a.label && a.label !== sportLabel(a.sport, a.subSport) ? `${SPORT_GROUP_LABEL[group]}: ${a.label}` : `${SPORT_GROUP_LABEL[group]}${group === 'other' && !manual ? `: ${sportLabel(a.sport, a.subSport)}` : ''}`],
    ['Moving time', formatDurationShort(a.movingS)],
    ...(a.distanceM !== null ? [['Distance', formatSportDistance(a.distanceM, group, units)] as [string, string]] : []),
    ...(a.avgHr !== null ? [['Heart rate', `${a.avgHr} avg${a.maxHr !== null ? ` · ${a.maxHr} max` : ''} bpm`] as [string, string]] : []),
    ['Load', loadText(a)],
    ...(a.trainingEffect ? [['Training Effect', `${a.trainingEffect.aerobic.toFixed(1)} aerobic${a.trainingEffect.anaerobic !== null ? ` · ${a.trainingEffect.anaerobic.toFixed(1)} anaerobic` : ''}`] as [string, string]] : []),
    ...(a.garminLoad !== null ? [['Garmin training load', String(Math.round(a.garminLoad))] as [string, string]] : []),
    ...(a.device ? [['Recorded with', a.device] as [string, string]] : []),
    ['From', SOURCE[a.source ?? 'fit']],
    ...(a.notes ? [['Notes', a.notes] as [string, string]] : []),
  ]

  const save = async () => {
    setError(null)
    try {
      const v = readDraft(draft, units, { needTime: true })
      await updateManualActivity(a.id, { date: dateKey(a.startedAt), group: v.group, label: v.label, durationS: v.durationS!, distanceM: v.distanceM, effort: v.effort, load: v.load, notes: v.notes })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const footer = editing ? (
    <>
      <Button variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      <Button variant="primary" onClick={() => void save()} data-testid="activity-save">
        Save
      </Button>
    </>
  ) : confirming ? (
    <div className="flex w-full flex-wrap items-center justify-between gap-2 text-sm">
      <span data-testid="activity-remove-warning">{removeWarning(a)}</span>
      <span className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" onClick={() => void removeActivity(a).then(onClose)} data-testid="activity-remove-confirm">
          Remove
        </Button>
      </span>
    </div>
  ) : (
    <>
      <Button variant="ghost" onClick={() => setConfirming(true)} data-testid="activity-remove">
        <Trash2 className="size-3.5" /> Remove
      </Button>
      {manual && (
        <Button onClick={() => setEditing(true)} data-testid="activity-edit">
          <Pencil className="size-3.5" /> Edit
        </Button>
      )}
    </>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={a.name} description={manual ? DAY.format(a.startedAt) : `${sportLabel(a.sport, a.subSport)}: ${WHEN.format(a.startedAt)}`} footer={footer}>
      {editing ? (
        <>
          <SessionFields draft={draft} onChange={setDraft} idPrefix="activity" />
          {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        </>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-testid="activity-details">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-dim">{k}</dt>
                <dd className="tabular">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-faint">
            {activityLoad(a) === null
              ? 'Without a load it still counts in weekly time, but adds nothing to fitness.'
              : 'Load is on the same scale as ride TSS (an hour at threshold is 100), so it adds up with your rides in weekly volume and fitness.'}
          </p>
        </>
      )}
    </Dialog>
  )
}
