// Keeps the CrankHog calendar in Google matching the planned entries the
// renderer last sent. One sync runs at a time and only the newest snapshot
// matters: snapshots that arrive mid-sync replace each other, and a failed
// sync retries with backoff (Retry-After honoured) until a newer snapshot or
// success. One request to Google is in flight at a time.
import { diffMirror, type MirrorEvent, type MirroredEvent } from '@core/calendar-mirror/mirror'
import type { DateKey } from '@core/workout/schedule'
import type { GoogleStatus } from '@shared/ipc/contract'
import { backoffMs, HttpError } from './http'
import { isGone, isRetryable, type GoogleClient } from './google'

export interface MirrorSnapshot {
  windowStart: DateKey
  events: MirrorEvent[]
  /** The calendar a restored backup knew for this account, to carry on with instead of making another. */
  calendarHint?: string
}

/** How a sync went: Google refused some changes outright, but the rest went through. */
interface SyncResult {
  eventCount: number
  total: number
  refused: HttpError[]
}

export interface SyncTimers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
  now(): number
}

const realTimers: SyncTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export class GoogleCalendarSync {
  private pending: MirrorSnapshot | null = null
  private loop: Promise<void> | null = null
  private retryTimer: unknown = null
  private attempt = 0
  private last: { lastSyncAt?: number; lastError?: string; eventCount?: number } = {}

  constructor(
    private readonly google: GoogleClient,
    private readonly onStatus: (s: GoogleStatus) => void = () => undefined,
    private readonly timers: SyncTimers = realTimers,
  ) {}

  status(): GoogleStatus {
    const calendarId = this.google.connected() ? this.google.knownCalendarId() : undefined
    return { ...this.google.account(), syncing: this.loop !== null, ...(calendarId ? { calendarId } : {}), ...this.last }
  }

  /** Makes the calendar match `snapshot`. Resolves once no sync is running (a retry may still be waiting). */
  request(snapshot: MirrorSnapshot): Promise<void> {
    this.pending = snapshot
    if (this.retryTimer !== null) {
      this.timers.clear(this.retryTimer)
      this.retryTimer = null
    }
    return this.kick()
  }

  /** Forgets everything after a sign-out: no retry left waiting, no stale error shown. */
  reset(): void {
    this.pending = null
    if (this.retryTimer !== null) this.timers.clear(this.retryTimer)
    this.retryTimer = null
    this.attempt = 0
    this.last = {}
    this.emit()
  }

  private kick(): Promise<void> {
    this.loop ??= this.drain()
    return this.loop
  }

  /** Works through snapshots until none is left. Clearing `loop` and finding nothing pending happen together, so no snapshot is missed. */
  private async drain(): Promise<void> {
    await Promise.resolve() // kick has set `loop`, so the status says syncing
    this.emit()
    for (;;) {
      const snap = this.pending
      if (!snap) return this.stop()
      this.pending = null
      try {
        const r = await this.syncOnce(snap)
        this.attempt = 0
        this.last = { lastSyncAt: this.timers.now(), eventCount: r.eventCount, ...(r.refused.length > 0 ? { lastError: refusedMessage(r) } : {}) }
        for (const e of r.refused) console.warn(`[google] calendar change refused: ${e.status} ${googleReason(e.body) ?? ''}`.trim())
      } catch (e) {
        this.last = { ...this.last, lastError: message(e) }
        console.warn(`[google] calendar sync failed: ${e instanceof HttpError ? `${e.status} ${googleReason(e.body) ?? ''}`.trim() : message(e)}`)
        if (isRetryable(e)) {
          this.pending ??= snap
          const wait = backoffMs(this.attempt++, e instanceof HttpError ? e.retryAfterS : null)
          this.retryTimer = this.timers.set(() => {
            this.retryTimer = null
            void this.kick()
          }, wait)
          return this.stop()
        }
        // signed out, or Google refused the request outright: the next snapshot tries again
      }
    }
  }

  private stop(): void {
    this.loop = null
    this.emit()
  }

  private async syncOnce(snap: MirrorSnapshot): Promise<SyncResult> {
    let calendarId = await this.google.ensureCalendar(snap.calendarHint)
    let actual: MirroredEvent[]
    try {
      actual = await this.google.listEvents(calendarId, snap.windowStart)
    } catch (e) {
      if (!(e instanceof HttpError) || !isGone(e)) throw e
      // the rider deleted the calendar in Google: make a fresh one
      this.google.forgetCalendar()
      calendarId = await this.google.ensureCalendar()
      actual = []
    }
    const diff = diffMirror(snap.events, actual, snap.windowStart)
    // One change Google refuses outright mustn't hold up the others. Anything
    // worth retrying (offline, rate limits, Google down) or a lost sign-in
    // stops the sync, and the retry or the next snapshot picks it all up again.
    const refused: HttpError[] = []
    const each = async (change: () => Promise<void>) => {
      try {
        await change()
      } catch (e) {
        if (!(e instanceof HttpError) || isRetryable(e)) throw e
        refused.push(e)
      }
    }
    const cid = calendarId
    for (const id of diff.delete) await each(() => this.google.deleteEvent(cid, id))
    for (const u of diff.update) {
      await each(async () => {
        try {
          await this.google.updateEvent(cid, u.eventId, u.event)
        } catch (e) {
          // deleted in Google since the list: put it back
          if (e instanceof HttpError && isGone(e)) await this.google.insertEvent(cid, u.event)
          else throw e
        }
      })
    }
    for (const e of diff.insert) await each(() => this.google.insertEvent(cid, e))
    const inWindow = new Set(snap.events.filter((e) => e.date >= snap.windowStart).map((e) => e.key)).size
    return { eventCount: inWindow, total: diff.delete.length + diff.update.length + diff.insert.length, refused }
  }

  private emit(): void {
    try {
      this.onStatus(this.status())
    } catch {
      // a window closing mid-send
    }
  }
}

function message(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 0) return 'Couldn’t reach Google. CrankHog will try again.'
    if (e.status >= 500) return 'Google Calendar had a problem. CrankHog will try again shortly.'
    if (isRetryable(e)) return 'Google asked CrankHog to slow down. It will try again shortly.'
    const reason = googleReason(e.body)
    return reason ? `Google Calendar refused the change: ${reason}` : `Google Calendar refused the change (${e.status}).`
  }
  return e instanceof Error ? e.message : String(e)
}

function refusedMessage(r: SyncResult): string {
  const n = r.refused.length
  const first = r.refused[0]!
  const reason = googleReason(first.body) ?? `status ${first.status}`
  return n === 1 && r.total === 1 ? `Google Calendar refused the change: ${reason}` : `Google Calendar refused ${n} of ${r.total} changes; the rest went through. The first: ${reason}`
}

const REASON_MAX = 200

/** Google's own words from an error body (`{ error: { message } }`), trimmed, or null when there are none. */
export function googleReason(body: string): string | null {
  try {
    const m = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message
    if (typeof m !== 'string' || !m.trim()) return null
    const one = m.trim().replace(/\s+/g, ' ')
    return one.length > REASON_MAX ? `${one.slice(0, REASON_MAX - 1)}…` : one
  } catch {
    return null
  }
}
