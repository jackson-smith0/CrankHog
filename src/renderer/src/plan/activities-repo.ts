// Activities that aren't rides in the history: those entered by hand, and
// removing any of them. FIT imports are in db/fit-import.ts, and intervals.icu
// syncs in plan/intervals-activities.ts.
import { SPORT_GROUP_LABEL, type SportGroup } from '@core/sport/group'
import { effortLoad, type Effort } from '@core/sport/load'
import { dateKey, dateKeyToMs, type DateKey } from '@core/workout/schedule'
import { db, type OtherActivity } from '../db/db'

/** intervals.icu activity ids the rider removed here, so a sync doesn't bring them back. */
export const HIDDEN_KEY = 'intervals.activities.hidden'

/** The FIT sport an activity entered by hand is stored under, so icons and names work as for imports. */
const FIT_SPORT: Record<SportGroup, string> = { ride: 'cycling', run: 'running', swim: 'swimming', other: 'generic' }

export interface ManualActivityInput {
  date: DateKey
  group: SportGroup
  label?: string
  durationS: number
  distanceM?: number | null
  effort?: Effort
  /** A load typed in; otherwise the effort gives one. */
  load?: number | null
  notes?: string
}

const newId = () => `man-${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`

/** When an activity entered for a day happened: just finished, today; midday, any other day. */
export function manualStart(date: DateKey, durationS: number, now = Date.now()): number {
  if (date === dateKey(now)) return Math.max(dateKeyToMs(date), now - durationS * 1000)
  return dateKeyToMs(date) + 12 * 3_600_000
}

function fields(input: ManualActivityInput): Omit<OtherActivity, 'id' | 'startedAt'> {
  const label = input.label?.trim() || undefined
  return {
    sport: FIT_SPORT[input.group],
    subSport: null,
    name: label ?? SPORT_GROUP_LABEL[input.group],
    movingS: input.durationS,
    distanceM: input.distanceM ?? null,
    avgHr: null,
    maxHr: null,
    hrLoad: null,
    trainingEffect: null,
    garminLoad: null,
    device: null,
    source: 'manual',
    group: input.group,
    label,
    manualLoad: input.load ?? effortLoad(input.durationS, input.effort),
    effort: input.effort,
    notes: input.notes?.trim() || undefined,
  }
}

/** Saves an activity typed in for a day. */
export async function addManualActivity(input: ManualActivityInput, now = Date.now()): Promise<OtherActivity> {
  const row: OtherActivity = { id: newId(), startedAt: manualStart(input.date, input.durationS, now), ...fields(input) }
  await db().activities.put(row)
  return row
}

/** Changes an activity entered by hand. Its day stays unless the date changes. */
export async function updateManualActivity(id: string, input: ManualActivityInput, now = Date.now()): Promise<void> {
  const old = await db().activities.get(id)
  if (!old || old.source !== 'manual') throw new Error('Only activities entered by hand can be edited.')
  const startedAt = dateKey(old.startedAt) === input.date ? old.startedAt : manualStart(input.date, input.durationS, now)
  await db().activities.put({ ...old, ...fields(input), startedAt })
}

/** Removes an activity. One from intervals.icu is remembered, so the next sync leaves it out. */
export async function removeActivity(a: Pick<OtherActivity, 'id' | 'source' | 'externalId'>): Promise<void> {
  await db().transaction('rw', db().activities, db().kv, async () => {
    if (a.externalId) {
      const row = await db().kv.get(HIDDEN_KEY)
      const hidden = Array.isArray(row?.value) ? (row.value as string[]) : []
      if (!hidden.includes(a.externalId)) await db().kv.put({ key: HIDDEN_KEY, value: [...hidden, a.externalId] })
    }
    await db().activities.delete(a.id)
  })
}

/** What removing an activity means, for the confirmation. */
export function removeWarning(a: Pick<OtherActivity, 'source' | 'externalId'>): string {
  if (a.source === 'intervals' || a.externalId) return 'Remove it from the calendar? It won’t come back from intervals.icu.'
  if (a.source === 'manual') return 'Remove it from the calendar? This can’t be undone.'
  return 'Remove it from the calendar? Importing its file again brings it back.'
}
