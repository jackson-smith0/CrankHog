// Completed activities from intervals.icu onto CrankHog's calendar: which to
// add, which to update, which an earlier sync added and intervals.icu no
// longer has, and which to leave out. Pure, so the rules are tested here; the
// renderer applies the result (src/renderer/src/plan/intervals-activities.ts).
//
// Left out:
// - CrankHog's own uploads (external id "freegaz-…"): the ride is already
//   in the history, with its streams.
// - anything starting within 90 s of a ride in the history (a ride imported
//   from its FIT file, or recorded here and uploaded by hand);
// - activities the rider removed here.
// An activity already on the calendar from its FIT file is matched rather
// than added twice: it keeps its own heart-rate load and learns its
// intervals.icu id and load.
import { groupOfIntervalsType, type SportGroup } from './group'

/** One completed activity as main passes it on (src/main/integrations/intervals.ts). */
export interface IcuActivity {
  id: string
  start_date_local: string
  start_date: string | null
  type: string | null
  name: string
  moving_time: number
  distance: number | null
  average_heartrate: number | null
  max_heartrate: number | null
  icu_training_load: number | null
  source: string | null
  external_id: string | null
}

/** What the sync needs to know about an activity already stored. */
export interface StoredActivityRef {
  id: string
  startedAt: number
  source?: 'fit' | 'intervals' | 'manual'
  externalId?: string
}

/** A synced activity's fields, as the renderer stores them. */
export interface SyncedActivity {
  id: string
  startedAt: number
  sport: string
  name: string
  movingS: number
  distanceM: number | null
  avgHr: number | null
  maxHr: number | null
  icuLoad: number | null
  group: SportGroup
  externalId: string
}

export interface SyncInput {
  fetched: readonly IcuActivity[]
  existing: readonly StoredActivityRef[]
  rides: readonly { startedAt: number }[]
  /** intervals.icu ids the rider removed here. */
  hidden: ReadonlySet<string>
  /** The range asked for, as epoch ms [from, to): rows an earlier sync put here and gone from intervals.icu are removed. */
  window: readonly [number, number]
}

export interface SyncPlan {
  /** New activities, and ones from an earlier sync with fresh numbers. */
  put: SyncedActivity[]
  /** FIT imports matched to their intervals.icu activity. */
  attach: { id: string; externalId: string; icuLoad: number | null }[]
  /** Activities an earlier sync added that intervals.icu no longer has. */
  remove: string[]
  counts: { added: number; updated: number; removed: number; ownUploads: number; rides: number; hidden: number }
}

/** Two activities starting this close together are the same activity. */
export const SAME_ACTIVITY_MS = 90_000

/** The id an intervals.icu activity is stored under. */
export const syncedId = (icuId: string) => `icu-${icuId}`

/** When an activity started: the UTC instant when given, else its local start read as local time. */
export function icuStart(a: Pick<IcuActivity, 'start_date' | 'start_date_local'>): number | null {
  if (a.start_date) {
    const t = Date.parse(a.start_date.endsWith('Z') || /[+-]\d\d:\d\d$/.test(a.start_date) ? a.start_date : `${a.start_date}Z`)
    if (Number.isFinite(t)) return t
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(a.start_date_local)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)).getTime()
}

/** "TrailRun" → "Trail run", for an activity without a name. */
const typeName = (t: string | null) => (t ? t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (_, c: string) => ` ${c.toLowerCase()}`) : 'Activity')

export function planIntervalsSync(input: SyncInput): SyncPlan {
  const counts = { added: 0, updated: 0, removed: 0, ownUploads: 0, rides: 0, hidden: 0 }
  const put: SyncedActivity[] = []
  const attach: SyncPlan['attach'] = []
  const near = (t: number, list: readonly { startedAt: number }[]) => list.some((x) => Math.abs(x.startedAt - t) < SAME_ACTIVITY_MS)
  const byExternal = new Map(input.existing.filter((e) => e.externalId).map((e) => [e.externalId!, e]))
  const unmatched = input.existing.filter((e) => e.source !== 'intervals' && !e.externalId)
  const seen = new Set<string>()

  for (const a of input.fetched) {
    seen.add(a.id)
    if (a.external_id?.startsWith('freegaz-')) {
      counts.ownUploads++
      continue
    }
    if (input.hidden.has(a.id)) {
      counts.hidden++
      continue
    }
    const startedAt = icuStart(a)
    if (startedAt === null) continue
    const known = byExternal.get(a.id)
    if (known && known.source !== 'intervals') continue
    if (!known && near(startedAt, input.rides)) {
      counts.rides++
      continue
    }
    if (!known) {
      const twin = unmatched.find((e) => Math.abs(e.startedAt - startedAt) < SAME_ACTIVITY_MS)
      if (twin) {
        attach.push({ id: twin.id, externalId: a.id, icuLoad: a.icu_training_load })
        unmatched.splice(unmatched.indexOf(twin), 1)
        continue
      }
    }
    put.push({
      id: syncedId(a.id),
      startedAt,
      sport: a.type ?? 'Workout',
      name: a.name || typeName(a.type),
      movingS: a.moving_time,
      distanceM: a.distance && a.distance > 0 ? a.distance : null,
      avgHr: a.average_heartrate !== null ? Math.round(a.average_heartrate) : null,
      maxHr: a.max_heartrate !== null ? Math.round(a.max_heartrate) : null,
      icuLoad: a.icu_training_load,
      group: groupOfIntervalsType(a.type),
      externalId: a.id,
    })
    if (known) counts.updated++
    else counts.added++
  }

  const [from, to] = input.window
  const remove = input.existing.filter((e) => e.source === 'intervals' && e.externalId && !seen.has(e.externalId) && e.startedAt >= from && e.startedAt < to).map((e) => e.id)
  counts.removed = remove.length
  return { put, attach, remove, counts }
}
