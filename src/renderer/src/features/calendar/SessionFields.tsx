// The fields of a session typed in by hand, for logging an activity or
// planning one: sport, what it was, time, distance, how hard, notes.
import { SPORT_GROUPS, SPORT_GROUP_LABEL, type SportGroup } from '@core/sport/group'
import { EFFORTS, EFFORT_LABEL, effortLoad, type Effort } from '@core/sport/load'
import { distanceFieldUnit, parseTimeField } from '@core/sport/session-input'
import type { SessionDraft } from './session-draft'
import { useSettings } from '../../stores/settings'
import { Field, Input } from '../../ui/form'
import { Segmented, type SegmentedOption } from '../../ui/Segmented'

const SPORTS: SegmentedOption<SportGroup>[] = SPORT_GROUPS.map((g) => ({ value: g, label: SPORT_GROUP_LABEL[g] }))
const EFFORT_OPTIONS: SegmentedOption<Effort>[] = EFFORTS.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))
const PLACEHOLDER: Record<SportGroup, string> = { ride: 'Outdoor ride', run: 'Easy run', swim: 'Pool swim', other: 'Squash' }

/** The form. `idPrefix` keeps test ids apart when two forms could be on screen. */
export function SessionFields({ draft, onChange, idPrefix = 'session' }: { draft: SessionDraft; onChange: (d: SessionDraft) => void; idPrefix?: string }) {
  const units = useSettings((s) => s.units)
  const set = (patch: Partial<SessionDraft>) => onChange({ ...draft, ...patch })
  const time = draft.time.trim() ? parseTimeField(draft.time) : null
  const fromEffort = effortLoad(time, draft.effort)
  return (
    <div className="divide-y divide-line">
      <Field label="Sport">
        <Segmented ariaLabel="Sport" value={draft.group} options={SPORTS} onChange={(group) => set({ group })} className="flex-wrap" />
      </Field>
      <Field label="What it was" hint="Shown on the calendar. Leave it empty to show the sport.">
        <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder={PLACEHOLDER[draft.group]} aria-label="What it was" data-testid={`${idPrefix}-label`} maxLength={60} />
      </Field>
      <Field label="Time" hint='Minutes, or hours and minutes: "45", "1:15".'>
        <Input value={draft.time} onChange={(e) => set({ time: e.target.value })} placeholder="45" inputMode="text" aria-label="Time" data-testid={`${idPrefix}-time`} />
      </Field>
      <Field label="Distance" hint={`Optional. A number is ${distanceFieldUnit(draft.group, units)}.`}>
        <Input value={draft.distance} onChange={(e) => set({ distance: e.target.value })} placeholder={draft.group === 'swim' ? (units === 'imperial' ? '1650' : '1500') : units === 'imperial' ? '5' : '8'} aria-label="Distance" data-testid={`${idPrefix}-distance`} />
      </Field>
      <Field label="How hard" hint={fromEffort !== null ? `About ${Math.round(fromEffort)} TSS for that time.` : 'Sets the load: an easy hour is about 40 TSS, an hour all out 100.'}>
        <Segmented ariaLabel="How hard" value={draft.effort} options={EFFORT_OPTIONS} onChange={(effort) => set({ effort })} className="flex-wrap" />
      </Field>
      <Field label="Load" hint="Optional. A TSS of your own instead of the one from how hard it was.">
        <Input value={draft.load} onChange={(e) => set({ load: e.target.value })} placeholder={fromEffort !== null ? String(Math.round(fromEffort)) : 'TSS'} inputMode="decimal" aria-label="Load" data-testid={`${idPrefix}-load`} />
      </Field>
      <Field label="Notes">
        <Input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} aria-label="Notes" maxLength={300} data-testid={`${idPrefix}-notes`} />
      </Field>
    </div>
  )
}
