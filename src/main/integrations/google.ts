// Google: sign-in (loopback redirect with PKCE) and the one calendar CrankHog
// keeps there, named "CrankHog", where planned training is mirrored as
// all-day events (core/calendar-mirror). The scope only reaches calendars
// this app created, never the rider's own.
//
// The Google app (a Desktop OAuth client) is built in when the build has
// one (google-app.ts); otherwise the rider makes their own and pastes it in,
// as with Strava. Tokens stay here, encrypted; the renderer never sees them.
import { createHash, randomBytes } from 'node:crypto'
import { allDayEnd, fingerprint, googleEventId, type MirrorEvent, type MirroredEvent } from '@core/calendar-mirror/mirror'
import { addDays, type DateKey } from '@core/workout/schedule'
import type { SecretStore } from '../secrets/secret-store'
import { HttpError, requestJson, requestText } from './http'
import { listenForCode } from './oauth-loopback'

export interface GoogleEndpoints {
  /** Where the rider's browser is sent to sign in. */
  authorize: string
  token: string
  revoke: string
  calendar: string
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  calendar: 'https://www.googleapis.com/calendar/v3',
}

/** Make secondary calendars, and manage the events on the ones this app made. Nothing else in the rider's calendar. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
export const GOOGLE_SCOPES = ['openid', 'email', CALENDAR_SCOPE]

export const MIRROR_CALENDAR_NAME = 'CrankHog'

export interface GoogleAppCredentials {
  clientId: string
  clientSecret: string
}

export interface GoogleTokens {
  accessToken: string
  refreshToken: string
  /** epoch seconds */
  expiresAt: number
  email?: string
}

/** The calendar CrankHog made, and for which account (the shape before calendars were kept per account). */
interface StoredCalendar {
  email: string | null
  calendarId: string
}

const SECRET_APP = 'google.app'
const SECRET_TOKENS = 'google.tokens'
/** One calendar for the last account only: read once and folded into SECRET_CALENDARS. */
const SECRET_CALENDAR_V1 = 'google.calendar'
/** The CrankHog calendar of each Google account signed in on this Mac, by address ("" when Google gave none). */
const SECRET_CALENDARS = 'google.calendars'

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  id_token?: string
}

interface GoogleEvent {
  id: string
  start?: { date?: string; dateTime?: string }
  extendedProperties?: { private?: Record<string, string> }
}

/** Sign-in that no longer works (revoked, expired, or a scope left unticked): signing in again is the fix, not retrying. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}

export class GoogleClient {
  constructor(
    private readonly secrets: SecretStore,
    private readonly builtIn: GoogleAppCredentials | null,
    private readonly endpoints: GoogleEndpoints = GOOGLE_ENDPOINTS,
    private readonly nowS: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  // ---- configuration ----------------------------------------------------

  setApp(creds: GoogleAppCredentials): void {
    this.secrets.setJson(SECRET_APP, creds)
  }

  /** CrankHog's own Google app when the build has one, else the rider's. */
  app(): GoogleAppCredentials | null {
    return this.builtIn ?? this.secrets.getJson<GoogleAppCredentials>(SECRET_APP)
  }

  tokens(): GoogleTokens | null {
    return this.secrets.getJson<GoogleTokens>(SECRET_TOKENS)
  }

  connected(): boolean {
    return this.tokens() !== null
  }

  account(): { configured: boolean; builtInApp: boolean; connected: boolean; email?: string } {
    const t = this.tokens()
    return { configured: this.app() !== null, builtInApp: this.builtIn !== null, connected: t !== null, ...(t?.email ? { email: t.email } : {}) }
  }

  /** Signs out: Google is told to drop the grant (best effort), and the tokens go. The calendar stays in Google. */
  async disconnect(): Promise<void> {
    const t = this.tokens()
    this.secrets.delete(SECRET_TOKENS)
    if (!t) return
    try {
      await requestText(this.endpoints.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refreshToken }).toString(), timeoutMs: 10_000 })
    } catch {
      // offline, or already revoked: the rider can remove CrankHog in their Google account
    }
  }

  // ---- OAuth -------------------------------------------------------------

  /**
   * Opens the system browser at Google's consent page and waits for the
   * redirect on a one-shot loopback listener. PKCE (S256) binds the code to
   * this attempt, as Google asks of desktop apps.
   */
  async connect(openExternal: (url: string) => Promise<void>, timeoutMs = 5 * 60_000): Promise<GoogleTokens> {
    const app = this.app()
    if (!app) throw new Error('Add your Google app’s client ID and secret first')
    const state = randomBytes(24).toString('hex')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const { server, port, code } = await listenForCode({
      path: '/google/callback',
      expectedState: state,
      timeoutMs,
      provider: 'Google',
      successMessage: 'Signed in with Google. You can close this tab: your planned training is on its way to your calendar.',
    })
    try {
      const redirect = `http://127.0.0.1:${port}/google/callback`
      const url = new URL(this.endpoints.authorize)
      url.searchParams.set('client_id', app.clientId)
      url.searchParams.set('redirect_uri', redirect)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      // a refresh token, every time, so a re-sign-in after a revoke still works
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
      await openExternal(url.toString())
      const authCode = await code
      const res = await this.tokenRequest({ client_id: app.clientId, client_secret: app.clientSecret, code: authCode, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect })
      if (!res.refresh_token) throw new Error('Google sent no refresh token. Try signing in again.')
      // Google lets the rider untick the calendar box on the consent page
      if (res.scope !== undefined && !res.scope.split(' ').includes(CALENDAR_SCOPE)) {
        throw new GoogleAuthError('CrankHog needs permission to manage its own calendar. Sign in again and leave the calendar box ticked.')
      }
      const tokens: GoogleTokens = { accessToken: res.access_token, refreshToken: res.refresh_token, expiresAt: this.nowS() + res.expires_in, ...emailOf(res.id_token) }
      this.secrets.setJson(SECRET_TOKENS, tokens)
      return tokens
    } finally {
      server.close()
    }
  }

  /** A valid access token, refreshed when less than five minutes are left. A refused refresh signs the rider out. */
  async accessToken(): Promise<string> {
    const app = this.app()
    const t = this.tokens()
    if (!app || !t) throw new GoogleAuthError('Sign in with Google first.')
    if (t.expiresAt - this.nowS() > 300) return t.accessToken
    let res: TokenResponse
    try {
      res = await this.tokenRequest({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'refresh_token', refresh_token: t.refreshToken })
    } catch (e) {
      if (e instanceof HttpError && (e.status === 400 || e.status === 401)) {
        this.secrets.delete(SECRET_TOKENS)
        throw new GoogleAuthError('Google signed CrankHog out. Sign in again to keep your calendar up to date.')
      }
      throw e
    }
    const next: GoogleTokens = { ...t, accessToken: res.access_token, refreshToken: res.refresh_token ?? t.refreshToken, expiresAt: this.nowS() + res.expires_in }
    this.secrets.setJson(SECRET_TOKENS, next)
    return next.accessToken
  }

  private tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    return requestJson<TokenResponse>(this.endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
  }

  // ---- the CrankHog calendar ----------------------------------------------

  private calendars(): Record<string, string> {
    const map = this.secrets.getJson<Record<string, string>>(SECRET_CALENDARS) ?? {}
    const v1 = this.secrets.getJson<StoredCalendar>(SECRET_CALENDAR_V1)
    if (!v1) return map
    const merged = { [v1.email ?? '']: v1.calendarId, ...map }
    this.secrets.setJson(SECRET_CALENDARS, merged)
    this.secrets.delete(SECRET_CALENDAR_V1)
    return merged
  }

  private accountKey(): string {
    return this.tokens()?.email ?? ''
  }

  private rememberCalendar(calendarId: string | null): void {
    const { [this.accountKey()]: _dropped, ...rest } = this.calendars()
    this.secrets.setJson(SECRET_CALENDARS, calendarId ? { ...rest, [this.accountKey()]: calendarId } : rest)
  }

  /** The CrankHog calendar this Mac knows for the signed-in account, if any. */
  knownCalendarId(): string | undefined {
    return this.calendars()[this.accountKey()]
  }

  /**
   * The CrankHog calendar's id. In order: the one this Mac keeps for the
   * signed-in account (so switching accounts back and forth never makes a
   * second one); then `hint`, the calendar a restored backup knew, when Google
   * confirms this app can still reach it (a new Mac carries on with the same
   * calendar); else a new calendar.
   */
  async ensureCalendar(hint?: string): Promise<string> {
    const known = this.knownCalendarId()
    if (known) return known
    if (hint) {
      try {
        await this.api('GET', `/calendars/${encodeURIComponent(hint)}`)
        this.rememberCalendar(hint)
        return hint
      } catch (e) {
        // gone, or made by another Google app or for another account: make a new one
        if (!(e instanceof HttpError) || !(isGone(e) || (e.status === 403 && !isRetryable(e)))) throw e
      }
    }
    const created = await this.api<{ id: string }>('POST', '/calendars', {
      summary: MIRROR_CALENDAR_NAME,
      description: 'Planned training from CrankHog. Plan, move and remove workouts in CrankHog, and this calendar follows.',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    this.rememberCalendar(created.id)
    return created.id
  }

  /** The account's calendar is gone (the rider deleted it in Google): the next ensureCalendar makes a new one. */
  forgetCalendar(): void {
    this.rememberCalendar(null)
  }

  /** Events in the calendar from the day before `from` on, with the key and fingerprint CrankHog stored on its own. */
  async listEvents(calendarId: string, from: DateKey): Promise<MirroredEvent[]> {
    const out: MirroredEvent[] = []
    let pageToken: string | undefined
    do {
      const q = new URLSearchParams({ maxResults: '2500', singleEvents: 'true', showDeleted: 'false', timeMin: `${addDays(from, -1)}T00:00:00Z`, fields: 'items(id,start,extendedProperties),nextPageToken' })
      if (pageToken) q.set('pageToken', pageToken)
      const page = await this.api<{ items?: GoogleEvent[]; nextPageToken?: string }>('GET', `/calendars/${encodeURIComponent(calendarId)}/events?${q.toString()}`)
      for (const item of page.items ?? []) {
        const date = item.start?.date ?? item.start?.dateTime?.slice(0, 10)
        if (!date) continue
        const p = item.extendedProperties?.private
        out.push({ eventId: item.id, date, key: p?.crankhogKey ?? null, fingerprint: p?.crankhogFp ?? null })
      }
      pageToken = page.nextPageToken
    } while (pageToken)
    return out
  }

  /**
   * Adds an event under the id derived from its key. A 409 means that id was
   * used before (a retried insert, or an event deleted and now planned
   * again): the event is restored by updating it, and if Google won't, it is
   * added under an id Google picks (the key still finds it).
   */
  async insertEvent(calendarId: string, e: MirrorEvent): Promise<void> {
    const id = googleEventId(e.key)
    try {
      await this.api('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, { id, ...eventBody(e) })
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 409) throw err
      try {
        await this.updateEvent(calendarId, id, e)
      } catch (again) {
        if (!(again instanceof HttpError) || !isGone(again)) throw again
        await this.api('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, eventBody(e))
      }
    }
  }

  async updateEvent(calendarId: string, eventId: string, e: MirrorEvent): Promise<void> {
    await this.api('PUT', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, eventBody(e))
  }

  /** Removes an event; one already gone is fine. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.api('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)
    } catch (e) {
      if (!(e instanceof HttpError) || !isGone(e)) throw e
    }
  }

  private async api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const token = await this.accessToken()
    const headers: Record<string, string> = { authorization: `Bearer ${token}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const text = await requestText(`${this.endpoints.calendar}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new HttpError('Invalid JSON from Google Calendar', 0, text)
    }
  }
}

/** The event as Google stores it: all day, free (it doesn't block the day), no reminders, tagged with its key and fingerprint. */
function eventBody(e: MirrorEvent) {
  return {
    summary: e.title,
    description: e.description,
    start: { date: e.date },
    end: { date: allDayEnd(e.date) },
    transparency: 'transparent',
    status: 'confirmed',
    reminders: { useDefault: false },
    extendedProperties: { private: { crankhogKey: e.key, crankhogFp: fingerprint(e) } },
  }
}

export const isGone = (e: HttpError): boolean => e.status === 404 || e.status === 410

/** Google's own retry advice: 429 and 5xx, and the 403 it sends for a rate limit. */
export function isRetryable(e: unknown): boolean {
  if (!(e instanceof HttpError)) return false
  return e.retryable || (e.status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(e.body))
}

/** The account's address, from the ID token Google just handed over directly (so no signature check is needed to show it). */
function emailOf(idToken: string | undefined): { email?: string } {
  const payload = idToken?.split('.')[1]
  if (!payload) return {}
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown }
    return typeof claims.email === 'string' ? { email: claims.email } : {}
  } catch {
    return {}
  }
}
