// intervals.icu: personal API key (Basic auth, username "API_KEY").
// Athlete id "0" means "the owner of this key".
import type { SecretStore } from '../secrets/secret-store'
import { HttpError, requestJson, requestText } from './http'

/** A planned ride from the athlete's intervals.icu calendar, trimmed to what CrankHog uses. */
export interface PlannedWorkoutEvent {
  id: string
  /** "2026-11-18T00:00:00", local to the athlete. */
  start_date_local: string
  name: string
  type: string | null
  /** The workout in intervals.icu's text format. */
  description: string | null
  /** The workout as a Zwift file, when intervals.icu could make one. */
  zwo: string | null
  /** The id the creator gave it; sessions CrankHog sent are "freegaz-plan-…". */
  external_id: string | null
  /** Planned seconds, as intervals.icu works it out. */
  moving_time: number | null
  icu_training_load: number | null
}

/** A completed activity from intervals.icu, trimmed to what the calendar uses. */
export interface IntervalsActivity {
  id: string
  /** "2026-11-18T07:12:00", local to the athlete. */
  start_date_local: string
  /** The same instant in UTC ("2026-11-18T15:12:00Z"), when given. */
  start_date: string | null
  /** "Run", "Swim", "Squash", "VirtualRide"… */
  type: string | null
  name: string
  /** Seconds. */
  moving_time: number
  /** Metres. */
  distance: number | null
  average_heartrate: number | null
  max_heartrate: number | null
  /** intervals.icu's training load: TSS from power, else from heart rate or pace. */
  icu_training_load: number | null
  /** Where intervals.icu got it: "GARMIN_CONNECT", "UPLOAD", "OAUTH_CLIENT"… */
  source: string | null
  /** The id the uploader gave it; CrankHog's own uploads are "freegaz-…". */
  external_id: string | null
}

/** A planned workout CrankHog sends to intervals.icu. */
export interface PlannedWorkoutOut {
  /** The local day, "2026-12-02". */
  date: string
  /** "Run", "Swim", "Ride", "Workout". */
  type: string
  name: string
  /** The steps in intervals.icu's workout text (without CrankHog's header lines). */
  description: string
  /** "freegaz-plan-<entry id>": CrankHog's mark, so an import from intervals.icu skips it. */
  externalId: string
  movingTimeS?: number | null
  load?: number | null
}

/** Longest calendar range one import may ask for. */
export const MAX_PLANNED_RANGE_DAYS = 92
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** Bounds on what is passed on from a third party. */
const MAX_EVENTS = 400
const MAX_ACTIVITIES = 1000
const MAX_TEXT = 20_000
const MAX_ZWO = 200_000

export const INTERVALS_API = 'https://intervals.icu/api/v1'
const SECRET = 'intervals.config'

export interface IntervalsConfig {
  apiKey: string
  athleteId: string
}

export class IntervalsClient {
  constructor(
    private readonly secrets: SecretStore,
    private readonly api = INTERVALS_API,
  ) {}

  configure(cfg: IntervalsConfig): void {
    this.secrets.setJson(SECRET, cfg)
  }

  clear(): void {
    this.secrets.delete(SECRET)
  }

  status(): { configured: boolean; athleteId?: string } {
    const c = this.secrets.getJson<IntervalsConfig>(SECRET)
    return { configured: !!c, athleteId: c?.athleteId }
  }

  /**
   * The workouts planned on the athlete's calendar from `oldest` to `newest`
   * (local dates, both included). With ext=zwo each one comes with a Zwift
   * file of its structure; CrankHog parses that, or the text description.
   */
  async plannedWorkouts(oldest: string, newest: string): Promise<PlannedWorkoutEvent[]> {
    const c = this.secrets.getJson<IntervalsConfig>(SECRET)
    if (!c) throw new Error('intervals.icu is not configured')
    if (!DATE.test(oldest) || !DATE.test(newest) || newest < oldest) throw new Error('Not a date range')
    const days = (Date.parse(newest) - Date.parse(oldest)) / 86_400_000
    if (days > MAX_PLANNED_RANGE_DAYS) throw new Error(`The range is limited to ${MAX_PLANNED_RANGE_DAYS} days`)
    const url = new URL(`${this.api}/athlete/${encodeURIComponent(c.athleteId || '0')}/events`)
    url.searchParams.set('oldest', oldest)
    url.searchParams.set('newest', newest)
    url.searchParams.set('category', 'WORKOUT')
    url.searchParams.set('ext', 'zwo')
    const res = await requestJson<unknown>(url.toString(), { headers: { authorization: basicAuth(c.apiKey) } })
    if (!Array.isArray(res)) throw new Error('intervals.icu returned something other than a list of events')
    return res.flatMap(toPlanned).slice(0, MAX_EVENTS)
  }

  /**
   * Completed activities from `oldest` to `newest` (local dates, both
   * included). Activities intervals.icu got from Strava come back without
   * their data (Strava doesn't let it pass them on); those are only counted,
   * so the rider can be told to connect Garmin to intervals.icu directly.
   */
  async activities(oldest: string, newest: string): Promise<{ activities: IntervalsActivity[]; fromStrava: number }> {
    const c = this.secrets.getJson<IntervalsConfig>(SECRET)
    if (!c) throw new Error('intervals.icu is not configured')
    if (!DATE.test(oldest) || !DATE.test(newest) || newest < oldest) throw new Error('Not a date range')
    const days = (Date.parse(newest) - Date.parse(oldest)) / 86_400_000
    if (days > MAX_PLANNED_RANGE_DAYS) throw new Error(`The range is limited to ${MAX_PLANNED_RANGE_DAYS} days`)
    const url = new URL(`${this.api}/athlete/${encodeURIComponent(c.athleteId || '0')}/activities`)
    url.searchParams.set('oldest', oldest)
    url.searchParams.set('newest', newest)
    const res = await requestJson<unknown>(url.toString(), { headers: { authorization: basicAuth(c.apiKey) } })
    if (!Array.isArray(res)) throw new Error('intervals.icu returned something other than a list of activities')
    let fromStrava = 0
    const activities: IntervalsActivity[] = []
    for (const raw of res.slice(0, MAX_ACTIVITIES)) {
      const a = toActivity(raw)
      if (a === 'strava') fromStrava++
      else if (a) activities.push(a)
    }
    return { activities, fromStrava }
  }

  /**
   * Puts a planned workout on the athlete's intervals.icu calendar, or
   * updates the one sent before (`eventId`). The description is the workout
   * in intervals.icu's text; intervals.icu reads it into steps and, if the
   * athlete allows it, sends it on to their Garmin. Returns the event's id.
   * An event deleted on intervals.icu since is created again.
   */
  async putPlannedWorkout(w: PlannedWorkoutOut, eventId?: string): Promise<{ eventId: string }> {
    const c = this.secrets.getJson<IntervalsConfig>(SECRET)
    if (!c) throw new Error('intervals.icu is not configured')
    if (!DATE.test(w.date)) throw new Error('Not a date')
    const base = `${this.api}/athlete/${encodeURIComponent(c.athleteId || '0')}/events`
    const body = JSON.stringify({
      category: 'WORKOUT',
      start_date_local: `${w.date}T00:00:00`,
      type: w.type,
      name: w.name,
      description: w.description,
      external_id: w.externalId,
      ...(w.movingTimeS ? { moving_time: Math.round(w.movingTimeS) } : {}),
      ...(w.load !== undefined && w.load !== null ? { icu_training_load: Math.round(w.load) } : {}),
    })
    const headers = { authorization: basicAuth(c.apiKey), 'content-type': 'application/json' }
    if (eventId) {
      try {
        const res = await requestJson<{ id?: number | string }>(`${base}/${encodeURIComponent(eventId)}`, { method: 'PUT', headers, body })
        return { eventId: String(res.id ?? eventId) }
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 404) throw e
      }
    }
    const res = await requestJson<{ id?: number | string }>(base, { method: 'POST', headers, body })
    if (res.id === undefined || res.id === null) throw new Error('intervals.icu did not return an event id')
    return { eventId: String(res.id) }
  }

  /** Takes a workout CrankHog sent off the athlete's intervals.icu calendar. One already gone counts as done. */
  async deletePlannedWorkout(eventId: string): Promise<void> {
    const c = this.secrets.getJson<IntervalsConfig>(SECRET)
    if (!c) throw new Error('intervals.icu is not configured')
    try {
      await requestText(`${this.api}/athlete/${encodeURIComponent(c.athleteId || '0')}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', headers: { authorization: basicAuth(c.apiKey) } })
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e
    }
  }

  async uploadFit(upload: { bytes: Uint8Array; fileName: string; name: string; description?: string; externalId: string }): Promise<{ activityId: string }> {
    const c = this.secrets.getJson<IntervalsConfig>(SECRET)
    if (!c) throw new Error('intervals.icu is not configured')
    const url = new URL(`${this.api}/athlete/${encodeURIComponent(c.athleteId || '0')}/activities`)
    url.searchParams.set('name', upload.name)
    if (upload.description) url.searchParams.set('description', upload.description)
    url.searchParams.set('external_id', upload.externalId)
    const form = new FormData()
    form.set('file', new Blob([upload.bytes.slice()], { type: 'application/octet-stream' }), upload.fileName)
    const res = await requestJson<{ id?: string; icu_athlete_id?: string } | { id: string }[]>(url.toString(), {
      method: 'POST',
      headers: { authorization: basicAuth(c.apiKey) },
      body: form,
    })
    const id = Array.isArray(res) ? res[0]?.id : res.id
    if (!id) throw new Error('intervals.icu did not return an activity id')
    return { activityId: String(id) }
  }
}

const basicAuth = (apiKey: string) => `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)

/** One event from the API, if it is a planned workout CrankHog can use; malformed ones are dropped. */
function toPlanned(raw: unknown): PlannedWorkoutEvent[] {
  if (raw === null || typeof raw !== 'object') return []
  const e = raw as Record<string, unknown>
  if (e.category !== 'WORKOUT') return []
  const id = typeof e.id === 'number' || typeof e.id === 'string' ? String(e.id).slice(0, 40) : null
  const start = str(e.start_date_local, 40)
  if (!id || !start || !DATE.test(start.slice(0, 10))) return []
  let zwo: string | null = null
  const file = str(e.workout_file_base64, (MAX_ZWO * 4) / 3 + 4)
  if (file) {
    const text = Buffer.from(file, 'base64').toString('utf8')
    zwo = text.length <= MAX_ZWO ? text : null
  }
  return [{ id, start_date_local: start, name: (str(e.name, 300) ?? '').trim(), type: str(e.type, 40), description: str(e.description, MAX_TEXT), zwo, external_id: str(e.external_id, 200), moving_time: num(e.moving_time, 86_400), icu_training_load: num(e.icu_training_load, 2000) }]
}

const num = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null)

/** One activity from the API: its summary, 'strava' for one intervals.icu may not pass on, or nothing when malformed. */
function toActivity(raw: unknown): IntervalsActivity | 'strava' | null {
  if (raw === null || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const id = typeof a.id === 'number' || typeof a.id === 'string' ? String(a.id).slice(0, 40) : null
  const start = str(a.start_date_local, 40)
  if (!id || !start || !DATE.test(start.slice(0, 10))) return null
  const source = str(a.source, 40)
  // only what intervals.icu says came from Strava is Strava's; anything else without a usable moving time is malformed
  if (source === 'STRAVA') return 'strava'
  const moving = num(a.moving_time, 7 * 86_400)
  if (moving === null) return null
  return {
    id,
    start_date_local: start,
    start_date: str(a.start_date, 40),
    type: str(a.type, 40),
    name: (str(a.name, 300) ?? '').trim(),
    moving_time: moving,
    distance: num(a.distance, 2_000_000),
    average_heartrate: num(a.average_heartrate, 260),
    max_heartrate: num(a.max_heartrate, 260),
    icu_training_load: num(a.icu_training_load, 2000),
    source,
    external_id: str(a.external_id, 200),
  }
}
