// Keeps the CrankHog calendar in Google up to date. Every change to the
// calendar here (a workout added, moved, renamed or removed, a plan
// re-laid, an intervals.icu import, an FTP change that moves TSS) re-runs
// the snapshot; a couple of seconds after the last change, the whole
// window goes to main, which makes Google match (core/calendar-mirror).
import { liveQuery } from 'dexie'
import { mirrorEvent, type MirrorSource } from '@core/calendar-mirror/event-text'
import { mirrorWindowStart, type MirrorEvent } from '@core/calendar-mirror/mirror'
import type { UnitSystem } from '@core/units'
import { dateKey, entrySport, isBikeWorkout, type DateKey, type ScheduledWorkout } from '@core/workout/schedule'
import { currentFtp, DEFAULT_FTP_W } from '../db/athlete-repo'
import { db } from '../db/db'
import { bridge } from '../platform/bridge'
import { settingsStore } from '../stores/settings'
import { describeWorkout, getWorkout, plannedStatsOf } from '../workouts/library'

export interface MirrorSnapshot {
  windowStart: DateKey
  events: MirrorEvent[]
}

/** Quiet time after the last change before sending: a plan re-lay is many writes, and one sync covers them. */
export const MIRROR_DEBOUNCE_MS = 2000
/** Sends again on this beat even with no change here, so the window moves on at midnight and events changed in Google go back. */
const RESEND_EVERY_MS = 60 * 60_000

/** Every planned entry from the window on, as the events Google should show. */
export async function mirrorSnapshot(now: number, units: UnitSystem): Promise<MirrorSnapshot> {
  const windowStart = mirrorWindowStart(dateKey(now))
  const entries = await db().schedule.where('date').aboveOrEqual(windowStart).toArray()
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const ftpW = (await currentFtp(now))?.ftpW ?? DEFAULT_FTP_W
  const events: MirrorEvent[] = []
  for (const e of entries) events.push(mirrorEvent(await sourceOf(e, ftpW), units))
  return { windowStart, events }
}

async function sourceOf(e: ScheduledWorkout, ftpW: number): Promise<MirrorSource> {
  const base: MirrorSource = { id: e.id, date: e.date, name: e.name, sport: entrySport(e) }
  if (isBikeWorkout(e)) {
    const w = e.workout ?? (e.workoutId ? await getWorkout(e.workoutId) : null)
    if (!w) return base
    const planned = plannedStatsOf(w, describeWorkout(w, ftpW).stats)
    return { ...base, durationS: planned.durationS, tss: planned.tss, ...(w.description ? { notes: w.description } : {}) }
  }
  const s = e.session
  if (!s) return base
  return {
    ...base,
    ...(s.label ? { label: s.label } : {}),
    durationS: s.durationS ?? null,
    distanceM: s.distanceM ?? null,
    load: s.load ?? null,
    ...(s.effort ? { effort: s.effort } : {}),
    ...(s.notes ? { notes: s.notes } : {}),
  }
}

let resendNow: (() => void) | null = null

/** Sends the calendar to Google now, even if nothing changed since the last send. */
export function syncGoogleNow(): void {
  resendNow?.()
}

/** Starts watching the calendar. Desktop app only: the browser and iPhone builds have no Google sign-in. */
export function startGoogleMirror(): () => void {
  if (__CRANKHOG_WEB__) return () => undefined
  let latest: MirrorSnapshot | null = null
  let lastSent: string | null = null
  let timer: number | undefined
  let connected = false

  const send = async (force: boolean) => {
    timer = undefined
    if (!latest || !connected || !settingsStore.getState().googleCalendar.enabled) return
    const body = JSON.stringify(latest)
    if (!force && body === lastSent) return
    try {
      const r = await bridge().invoke('google.calendar.sync', latest)
      lastSent = r.ok ? body : null
    } catch {
      lastSent = null
    }
  }
  const later = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void send(false), MIRROR_DEBOUNCE_MS)
  }
  resendNow = () => void send(true)

  // the snapshot re-runs whenever a table it read changes: the schedule, the workouts, the FTP history
  let units = settingsStore.getState().units
  let sub = watch()
  function watch() {
    return liveQuery(() => mirrorSnapshot(Date.now(), units)).subscribe({
      next: (snap) => {
        latest = snap
        later()
      },
      error: () => undefined,
    })
  }

  const offSettings = settingsStore.subscribe((s, prev) => {
    if (s.units !== prev.units) {
      units = s.units
      sub.unsubscribe()
      sub = watch()
    }
    if (s.googleCalendar.enabled && !prev.googleCalendar.enabled) void send(true)
  })
  const onStatus = (s: { connected: boolean }) => {
    const signedIn = s.connected && !connected
    connected = s.connected
    if (signedIn) void send(true)
  }
  const offStatus = bridge().on('google.calendar.changed', onStatus)
  void bridge()
    .invoke('google.status', {})
    .then(onStatus)
    .catch(() => undefined)
  const beat = window.setInterval(() => {
    // a new day moves the window: take a fresh snapshot, then send it whatever it holds
    void mirrorSnapshot(Date.now(), units).then((snap) => {
      latest = snap
      return send(true)
    })
  }, RESEND_EVERY_MS)

  return () => {
    sub.unsubscribe()
    offSettings()
    offStatus()
    window.clearTimeout(timer)
    window.clearInterval(beat)
    resendNow = null
  }
}
