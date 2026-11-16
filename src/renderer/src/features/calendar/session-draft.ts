// A session typed in by hand, as the form holds it and as it reads: the
// fields are text until saved, so a half-typed time is never lost.
import type { SportGroup } from '@core/sport/group'
import type { Effort } from '@core/sport/load'
import { distanceFieldUnit, parseDistanceField, parseTimeField } from '@core/sport/session-input'

export interface SessionDraft {
  group: SportGroup
  label: string
  time: string
  distance: string
  effort: Effort
  load: string
  notes: string
}

export interface SessionValues {
  group: SportGroup
  label?: string
  durationS: number | null
  distanceM: number | null
  effort: Effort
  load: number | null
  notes?: string
}

export const emptyDraft = (group: SportGroup = 'run'): SessionDraft => ({ group, label: '', time: '', distance: '', effort: 'moderate', load: '', notes: '' })

/** Reads the draft. Throws a message for the rider when a field doesn't make sense. */
export function readDraft(d: SessionDraft, units: 'metric' | 'imperial', opts: { needTime: boolean }): SessionValues {
  const durationS = d.time.trim() ? parseTimeField(d.time) : null
  if (d.time.trim() && durationS === null) throw new Error('Time: write minutes ("45"), hours and minutes ("1:15"), or "1h15m".')
  const distanceM = d.distance.trim() ? parseDistanceField(d.distance, d.group, units) : null
  if (d.distance.trim() && distanceM === null) throw new Error(`Distance: a number of ${distanceFieldUnit(d.group, units)}, or with a unit ("8 km", "1500 m").`)
  if (opts.needTime && durationS === null) throw new Error('How long was it? Fill in the time.')
  if (!opts.needTime && durationS === null && distanceM === null) throw new Error('Give a time or a distance.')
  let load: number | null = null
  if (d.load.trim()) {
    load = Number(d.load)
    if (!Number.isFinite(load) || load < 0 || load > 1000) throw new Error('Load: a TSS between 0 and 1000, or leave it empty.')
  }
  return { group: d.group, label: d.label.trim() || undefined, durationS, distanceM, effort: d.effort, load, notes: d.notes.trim() || undefined }
}

