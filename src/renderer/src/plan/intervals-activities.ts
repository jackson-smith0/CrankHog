// Completed activities from intervals.icu onto the calendar: runs, swims,
// squash games and outdoor rides recorded on a Garmin and synced there. The
// rules are in @core/sport/intervals-activity; this fetches, applies the
// result in one transaction, and runs it on a schedule while the rider has
// it turned on (Settings, Integrations).
//
// Activities intervals.icu got from Strava can't be passed on (Strava's API
// terms), so they are only counted, and the rider is told to connect Garmin
// to intervals.icu directly. Nothing synced here ever reaches the AI.
import { planIntervalsSync, SAME_ACTIVITY_MS } from '@core/sport/intervals-activity'
import { addDays, dateKey, dateKeyToMs } from '@core/workout/schedule'
import { db, type OtherActivity } from '../db/db'
import { bridge } from '../platform/bridge'
import { settingsStore } from '../stores/settings'
import { HIDDEN_KEY } from './activities-repo'

/** The first sync looks this far back, so fitness has the weeks it needs. */
export const FIRST_SYNC_DAYS = 90
/** Later syncs look this far back, for activities that reached intervals.icu late or changed. */
export const RESYNC_DAYS = 14
const LAST_KEY = 'intervals.activities.lastSync'

export interface ActivitySyncResult {
  added: number
  updated: number
  removed: number
  /** Activities intervals.icu got from Strava, which it can't pass on. */
  fromStrava: number
  at: number
}

const kvGet = async <T>(key: string): Promise<T | undefined> => (await db().kv.get(key))?.value as T | undefined

/** The last sync's result, or undefined before the first. */
export const lastActivitySync = () => kvGet<ActivitySyncResult>(LAST_KEY)

/** Fetches recent activities from intervals.icu and brings the calendar in line. */
export async function syncIntervalsActivities(now = Date.now()): Promise<ActivitySyncResult> {
  const last = await lastActivitySync()
  const today = dateKey(now)
  const oldest = addDays(today, -(last ? RESYNC_DAYS : FIRST_SYNC_DAYS))
  const { activities: fetched, fromStrava } = await bridge().invoke('intervals.activities', { oldest, newest: today })

  const window = [dateKeyToMs(oldest), dateKeyToMs(addDays(today, 1))] as const
  const d = db()
  const result = await d.transaction('rw', [d.activities, d.rides, d.kv], async () => {
    // a day either side, so a twin a few seconds over the window's edge still matches
    const lo = window[0] - 86_400_000
    const hi = window[1] + 86_400_000
    const [existing, rides, hidden] = await Promise.all([
      d.activities.where('startedAt').between(lo, hi).toArray(),
      d.rides.where('startedAt').between(lo - SAME_ACTIVITY_MS, hi + SAME_ACTIVITY_MS).toArray(),
      kvGet<string[]>(HIDDEN_KEY),
    ])
    const plan = planIntervalsSync({ fetched, existing, rides: rides.filter((r) => !r.simulated), hidden: new Set(hidden ?? []), window })
    const rows: OtherActivity[] = plan.put.map((a) => ({ ...a, subSport: null, hrLoad: null, trainingEffect: null, garminLoad: null, device: null, source: 'intervals' }))
    await d.activities.bulkPut(rows)
    for (const a of plan.attach) await d.activities.update(a.id, { externalId: a.externalId, icuLoad: a.icuLoad })
    await d.activities.bulkDelete(plan.remove)
    const r: ActivitySyncResult = { added: plan.counts.added, updated: plan.counts.updated, removed: plan.counts.removed, fromStrava, at: now }
    await d.kv.put({ key: LAST_KEY, value: r })
    return r
  })
  return result
}

/** How long after the last sync a window focus syncs again. */
export const FOCUS_RESYNC_MS = 30 * 60_000
/** How often it syncs while the app is open. */
export const RESYNC_EVERY_MS = 2 * 3_600_000

let running: Promise<ActivitySyncResult | null> | null = null

/** Syncs when the rider has it turned on and intervals.icu is set up; failures wait for the next try. One at a time. */
export function syncIfOn(now = Date.now()): Promise<ActivitySyncResult | null> {
  if (!settingsStore.getState().intervalsSync.activities) return Promise.resolve(null)
  running ??= (async () => {
    try {
      const status = await bridge().invoke('intervals.status', {})
      if (!status.configured) return null
      return await syncIntervalsActivities(now)
    } catch {
      return null
    } finally {
      running = null
    }
  })()
  return running
}

/** At launch, on focus after a while away, and every couple of hours while open. */
export function startActivitySync(): () => void {
  void syncIfOn()
  const onFocus = () =>
    void lastActivitySync().then((last) => {
      if (!last || Date.now() - last.at > FOCUS_RESYNC_MS) void syncIfOn()
    })
  window.addEventListener('focus', onFocus)
  const timer = window.setInterval(() => void syncIfOn(), RESYNC_EVERY_MS)
  const off = settingsStore.subscribe((s, prev) => {
    if (s.intervalsSync.activities && !prev.intervalsSync.activities) void syncIfOn()
  })
  return () => {
    window.removeEventListener('focus', onFocus)
    window.clearInterval(timer)
    off()
  }
}
