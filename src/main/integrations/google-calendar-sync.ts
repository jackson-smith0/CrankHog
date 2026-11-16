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
    return { ...this.google.account(), syncing: this.loop !== null, ...this.last }
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
        const eventCount = await this.syncOnce(snap)
        this.attempt = 0
        this.last = { lastSyncAt: this.timers.now(), eventCount }
      } catch (e) {
        this.last = { ...this.last, lastError: message(e) }
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

  private async syncOnce(snap: MirrorSnapshot): Promise<number> {
    let calendarId = await this.google.ensureCalendar()
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
    for (const id of diff.delete) await this.google.deleteEvent(calendarId, id)
    for (const u of diff.update) await this.google.updateEvent(calendarId, u.eventId, u.event)
    for (const e of diff.insert) await this.google.insertEvent(calendarId, e)
    return new Set(snap.events.filter((e) => e.date >= snap.windowStart).map((e) => e.key)).size
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
    if (isRetryable(e)) return 'Google asked CrankHog to slow down. It will try again shortly.'
    return `Google Calendar refused the change (${e.status}).`
  }
  return e instanceof Error ? e.message : String(e)
}
