import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { googleEventId, type MirrorEvent } from '@core/calendar-mirror/mirror'
import { SecretStore, type Cipher } from '../secrets/secret-store'
import { CALENDAR_SCOPE, GoogleAuthError, GoogleClient, type GoogleEndpoints } from './google'
import { GoogleCalendarSync, googleReason, type SyncTimers } from './google-calendar-sync'

const plainCipher: Cipher = { isAvailable: () => true, encrypt: (s) => Buffer.from(s, 'utf8'), decrypt: (b) => b.toString('utf8') }
const APP = { clientId: '1234-abcdefgh.apps.googleusercontent.com', clientSecret: 'GOCSPX-fake-xxxxxxxxxxxxxxxx' }

interface StoredEvent {
  id: string
  status: 'confirmed' | 'cancelled'
  summary: string
  description: string
  start: { date: string }
  end: { date: string }
  extendedProperties?: { private?: Record<string, string> }
}

interface MockState {
  tokenCalls: Record<string, string>[]
  revoked: string[]
  calendars: Map<string, Map<string, StoredEvent>>
  calendarsCreated: number
  /** Answer the next N calendar API calls with this status. */
  failNext: { status: number; count: number; body?: string; retryAfter?: string } | null
  /** Refuse refresh_token grants (a revoked grant). */
  refuseRefresh: boolean
  grantedScope: string
  calls: string[]
  /** The address Google's ID token carries for the next sign-in. */
  email: string
  /** Event titles Google refuses outright (400), one change at a time. */
  refuseTitles: Set<string>
}

const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => resolve(b))
  })
}

async function startMock(state: MockState): Promise<{ server: Server; base: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const body = await readBody(req)
    res.setHeader('content-type', 'application/json')
    const send = (status: number, payload: unknown) => {
      res.statusCode = status
      res.end(payload === undefined ? '' : JSON.stringify(payload))
    }
    if (url.pathname === '/token') {
      const p = Object.fromEntries(new URLSearchParams(body))
      state.tokenCalls.push(p)
      if (p.grant_type === 'refresh_token' && state.refuseRefresh) return send(400, { error: 'invalid_grant' })
      const n = state.tokenCalls.length
      return send(200, {
        access_token: `access-${n}`,
        expires_in: 3599,
        scope: state.grantedScope,
        ...(p.grant_type === 'authorization_code' ? { refresh_token: 'refresh-1', id_token: idToken({ email: state.email }) } : {}),
      })
    }
    if (url.pathname === '/revoke') {
      state.revoked.push(new URLSearchParams(body).get('token') ?? '')
      return send(200, {})
    }
    if (!url.pathname.startsWith('/calendar/v3')) return send(404, {})
    state.calls.push(`${req.method} ${url.pathname.replace('/calendar/v3', '')}`)
    if (state.failNext && state.failNext.count > 0) {
      state.failNext.count--
      if (state.failNext.retryAfter) res.setHeader('retry-after', state.failNext.retryAfter)
      res.statusCode = state.failNext.status
      return res.end(state.failNext.body ?? '{}')
    }
    const path = url.pathname.replace('/calendar/v3', '').split('/').filter(Boolean).map(decodeURIComponent)
    if (path[0] === 'calendars' && path.length === 1 && req.method === 'POST') {
      const id = `cal${++state.calendarsCreated}@group.calendar.google.com`
      state.calendars.set(id, new Map())
      return send(200, { id, summary: JSON.parse(body).summary })
    }
    const cal = state.calendars.get(path[1] ?? '')
    if (!cal) return send(404, { error: { message: 'Not Found' } })
    if (path.length === 2 && req.method === 'GET') return send(200, { id: path[1], summary: 'CrankHog' })
    if ((req.method === 'POST' || req.method === 'PUT') && state.refuseTitles.has((JSON.parse(body) as StoredEvent).summary)) {
      return send(400, { error: { code: 400, message: 'Invalid start time.' } })
    }
    if (path[2] === 'events' && path.length === 3 && req.method === 'GET') {
      const items = [...cal.values()].filter((e) => e.status === 'confirmed')
      return send(200, { items })
    }
    if (path[2] === 'events' && path.length === 3 && req.method === 'POST') {
      const e = JSON.parse(body) as StoredEvent
      const id = e.id ?? `auto${cal.size + 1}`
      if (cal.has(id)) return send(409, { error: { message: 'The requested identifier already exists.' } })
      cal.set(id, { ...e, id, status: 'confirmed' })
      return send(200, cal.get(id))
    }
    const eventId = path[3] ?? ''
    const existing = cal.get(eventId)
    if (req.method === 'PUT') {
      if (!existing) return send(404, {})
      cal.set(eventId, { ...(JSON.parse(body) as StoredEvent), id: eventId })
      return send(200, cal.get(eventId))
    }
    if (req.method === 'DELETE') {
      if (!existing || existing.status === 'cancelled') return send(410, {})
      existing.status = 'cancelled'
      res.statusCode = 204
      return res.end()
    }
    send(400, {})
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

let state: MockState
let mock: { server: Server; base: string }
let endpoints: GoogleEndpoints
let secrets: SecretStore
let nowS: number

beforeEach(async () => {
  state = { tokenCalls: [], revoked: [], calendars: new Map(), calendarsCreated: 0, failNext: null, refuseRefresh: false, grantedScope: `openid ${CALENDAR_SCOPE} https://www.googleapis.com/auth/userinfo.email`, calls: [], email: 'rider@example.com', refuseTitles: new Set() }
  mock = await startMock(state)
  endpoints = { authorize: `${mock.base}/auth`, token: `${mock.base}/token`, revoke: `${mock.base}/revoke`, calendar: `${mock.base}/calendar/v3` }
  secrets = SecretStore.inDir(mkdtempSync(join(tmpdir(), 'crankhog-google-')), plainCipher)
  nowS = 1_800_000_000
})
afterEach(() => new Promise<void>((r) => mock.server.close(() => r())))

const client = (builtIn: typeof APP | null = APP) => new GoogleClient(secrets, builtIn, endpoints, () => nowS)

/** Pretends to be the rider's browser: checks the consent URL, then follows it straight to the redirect. */
let lastAuthUrl: URL
async function fakeBrowser(url: string, tamperState = false): Promise<void> {
  lastAuthUrl = new URL(url)
  const redirect = new URL(lastAuthUrl.searchParams.get('redirect_uri')!)
  expect(redirect.hostname).toBe('127.0.0.1')
  redirect.searchParams.set('code', 'the-auth-code')
  redirect.searchParams.set('state', tamperState ? 'evil' : lastAuthUrl.searchParams.get('state')!)
  await fetch(redirect)
}

async function signedIn(): Promise<GoogleClient> {
  const g = client()
  await g.connect(fakeBrowser)
  return g
}

const ev = (key: string, date: string, title = `Workout ${key}`): MirrorEvent => ({ key, date, title, description: 'Ride · 1 h' })
const events = () => [...state.calendars.values()].flatMap((c) => [...c.values()]).filter((e) => e.status === 'confirmed')

describe('Google sign-in', () => {
  it('uses PKCE, asks only for its own calendars, and keeps the tokens and address', async () => {
    const g = client()
    expect(g.account()).toEqual({ configured: true, builtInApp: true, connected: false })
    const t = await g.connect(fakeBrowser)
    expect(lastAuthUrl.searchParams.get('scope')).toBe(`openid email ${CALENDAR_SCOPE}`)
    expect(lastAuthUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(lastAuthUrl.searchParams.get('access_type')).toBe('offline')
    const exchange = state.tokenCalls[0]!
    expect(exchange).toMatchObject({ grant_type: 'authorization_code', code: 'the-auth-code', client_id: APP.clientId, client_secret: APP.clientSecret })
    expect(createHash('sha256').update(exchange.code_verifier!).digest('base64url')).toBe(lastAuthUrl.searchParams.get('code_challenge'))
    expect(exchange.redirect_uri).toBe(lastAuthUrl.searchParams.get('redirect_uri'))
    expect(t).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: nowS + 3599, email: 'rider@example.com' })
    expect(g.account()).toEqual({ configured: true, builtInApp: true, connected: true, email: 'rider@example.com' })
  })

  it('needs an app: built in, or the rider’s own', async () => {
    const g = client(null)
    expect(g.account().configured).toBe(false)
    await expect(g.connect(fakeBrowser)).rejects.toThrow(/client ID/)
    g.setApp(APP)
    expect(g.account()).toMatchObject({ configured: true, builtInApp: false })
    await g.connect(fakeBrowser)
    expect(g.connected()).toBe(true)
  })

  it('rejects a redirect with the wrong state', async () => {
    await expect(client().connect((url) => fakeBrowser(url, true))).rejects.toThrow(/state mismatch/)
    expect(state.tokenCalls).toHaveLength(0)
  })

  it('refuses a sign-in with the calendar box unticked', async () => {
    state.grantedScope = 'openid email'
    await expect(client().connect(fakeBrowser)).rejects.toBeInstanceOf(GoogleAuthError)
    expect(client().connected()).toBe(false)
  })

  it('refreshes the access token near expiry, keeping the refresh token', async () => {
    const g = await signedIn()
    expect(await g.accessToken()).toBe('access-1')
    nowS += 3400
    expect(await g.accessToken()).toBe('access-2')
    expect(state.tokenCalls[1]).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1' })
    expect(g.tokens()?.refreshToken).toBe('refresh-1')
  })

  it('signs out when Google refuses the refresh', async () => {
    const g = await signedIn()
    state.refuseRefresh = true
    nowS += 4000
    await expect(g.accessToken()).rejects.toBeInstanceOf(GoogleAuthError)
    expect(g.connected()).toBe(false)
  })

  it('revokes the grant on disconnect', async () => {
    const g = await signedIn()
    await g.disconnect()
    expect(state.revoked).toEqual(['refresh-1'])
    expect(g.connected()).toBe(false)
  })
})

describe('the CrankHog calendar', () => {
  const manualTimers = () => {
    const pending: { fn: () => void; ms: number }[] = []
    const timers: SyncTimers = { set: (fn, ms) => pending.push({ fn, ms }), clear: () => undefined, now: () => 42 }
    return { timers, pending }
  }

  it('makes the calendar once, and mirrors adds, moves, renames and removals as all-day events', async () => {
    const g = await signedIn()
    const sync = new GoogleCalendarSync(g)
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18'), ev('b', '2026-11-19')] })
    expect(state.calendarsCreated).toBe(1)
    expect(events().map((e) => [e.id, e.start.date, e.end.date, e.summary])).toEqual([
      [googleEventId('a'), '2026-11-18', '2026-11-19', 'Workout a'],
      [googleEventId('b'), '2026-11-19', '2026-11-20', 'Workout b'],
    ])
    expect(sync.status()).toMatchObject({ connected: true, email: 'rider@example.com', syncing: false, lastSyncAt: expect.any(Number), eventCount: 2 })

    state.calls = []
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-21'), ev('b', '2026-11-19', 'Threshold'), ev('c', '2026-11-22')] })
    expect(events().map((e) => [e.id, e.start.date, e.summary])).toEqual([
      [googleEventId('a'), '2026-11-21', 'Workout a'],
      [googleEventId('b'), '2026-11-19', 'Threshold'],
      [googleEventId('c'), '2026-11-22', 'Workout c'],
    ])
    expect(state.calendarsCreated).toBe(1)

    state.calls = []
    await sync.request({ windowStart: '2026-11-01', events: [ev('c', '2026-11-22')] })
    expect(events().map((e) => e.id)).toEqual([googleEventId('c')])

    // nothing changed: one list, no writes
    state.calls = []
    await sync.request({ windowStart: '2026-11-01', events: [ev('c', '2026-11-22')] })
    expect(state.calls.filter((c) => !c.startsWith('GET'))).toEqual([])
  })

  it('brings back an entry planned again after its event was removed', async () => {
    const sync = new GoogleCalendarSync(await signedIn())
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    await sync.request({ windowStart: '2026-11-01', events: [] })
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-20')] })
    expect(events().map((e) => [e.id, e.start.date])).toEqual([[googleEventId('a'), '2026-11-20']])
  })

  it('makes a new calendar when the rider deleted it in Google', async () => {
    const sync = new GoogleCalendarSync(await signedIn())
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    state.calendars.clear()
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(state.calendarsCreated).toBe(2)
    expect(events()).toHaveLength(1)
  })

  it('backs off on a rate limit, honouring Retry-After, then catches up', async () => {
    const { timers, pending } = manualTimers()
    const sync = new GoogleCalendarSync(await signedIn(), undefined, timers)
    state.failNext = { status: 403, count: 1, body: '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}', retryAfter: '7' }
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(sync.status().lastError).toMatch(/slow down/)
    expect(pending.map((p) => p.ms)).toEqual([7000])
    pending.shift()!.fn()
    await new Promise((r) => setTimeout(r, 50))
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(events()).toHaveLength(1)
    expect(sync.status().lastError).toBeUndefined()
  })

  it('doesn’t retry a refusal, and the next snapshot tries again', async () => {
    const { timers, pending } = manualTimers()
    const sync = new GoogleCalendarSync(await signedIn(), undefined, timers)
    state.failNext = { status: 403, count: 1, body: JSON.stringify({ error: { code: 403, message: 'Google Calendar API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }) }
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(sync.status().lastError).toBe('Google Calendar refused the change: Google Calendar API has not been used in project 123 before or it is disabled.')
    expect(pending).toHaveLength(0)
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(events()).toHaveLength(1)
  })

  it('only syncs the newest of the snapshots that arrive during a sync', async () => {
    const sync = new GoogleCalendarSync(await signedIn())
    const first = sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    void sync.request({ windowStart: '2026-11-01', events: [ev('b', '2026-11-19')] })
    const last = sync.request({ windowStart: '2026-11-01', events: [ev('c', '2026-11-20')] })
    await Promise.all([first, last])
    expect(events().map((e) => e.id)).toEqual([googleEventId('c')])
  })

  it('lets the other changes through when Google refuses one, and says which', async () => {
    const sync = new GoogleCalendarSync(await signedIn())
    state.refuseTitles.add('Workout b')
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18'), ev('b', '2026-11-19'), ev('c', '2026-11-20')] })
    expect(events().map((e) => e.summary)).toEqual(['Workout a', 'Workout c'])
    expect(sync.status()).toMatchObject({ lastError: 'Google Calendar refused 1 of 3 changes; the rest went through. The first: Invalid start time.', lastSyncAt: expect.any(Number) })
    state.refuseTitles.clear()
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18'), ev('b', '2026-11-19'), ev('c', '2026-11-20')] })
    expect(events()).toHaveLength(3)
    expect(sync.status().lastError).toBeUndefined()
  })

  it('keeps one calendar per account, so switching back and forth makes no second one', async () => {
    const g = await signedIn()
    const sync = new GoogleCalendarSync(g)
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    const first = sync.status().calendarId
    expect(first).toBe('cal1@group.calendar.google.com')
    state.email = 'other@example.com'
    await g.connect(fakeBrowser)
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(sync.status().calendarId).toBe('cal2@group.calendar.google.com')
    state.email = 'rider@example.com'
    await g.connect(fakeBrowser)
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(sync.status().calendarId).toBe(first)
    expect(state.calendarsCreated).toBe(2)
  })

  it('carries on with the calendar a restored backup knew, on a new Mac', async () => {
    await new GoogleCalendarSync(await signedIn()).request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    // a new Mac: nothing stored in main, only the calendar id from the backup
    secrets = SecretStore.inDir(mkdtempSync(join(tmpdir(), 'crankhog-google-')), plainCipher)
    const sync = new GoogleCalendarSync(await signedIn())
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18'), ev('b', '2026-11-19')], calendarHint: 'cal1@group.calendar.google.com' })
    expect(state.calendarsCreated).toBe(1)
    expect(events().map((e) => e.summary)).toEqual(['Workout a', 'Workout b'])
    expect(sync.status().calendarId).toBe('cal1@group.calendar.google.com')
  })

  it('makes a new calendar when the backed-up one is gone', async () => {
    const sync = new GoogleCalendarSync(await signedIn())
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')], calendarHint: 'deleted@group.calendar.google.com' })
    expect(state.calendarsCreated).toBe(1)
    expect(sync.status().calendarId).toBe('cal1@group.calendar.google.com')
  })

  it('keeps using the calendar stored before calendars were kept per account', async () => {
    const g = await signedIn()
    state.calendars.set('old@group.calendar.google.com', new Map())
    secrets.setJson('google.calendar', { email: 'rider@example.com', calendarId: 'old@group.calendar.google.com' })
    const sync = new GoogleCalendarSync(g)
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(state.calendarsCreated).toBe(0)
    expect(sync.status().calendarId).toBe('old@group.calendar.google.com')
    expect(secrets.getJson('google.calendar')).toBeNull()
  })

  it('says so when it isn’t signed in', async () => {
    const sync = new GoogleCalendarSync(client())
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(sync.status()).toMatchObject({ connected: false, lastError: 'Sign in with Google first.' })
  })
})

describe('Google’s reasons', () => {
  it('come from the error body, trimmed to one short line, or not at all', () => {
    expect(googleReason(JSON.stringify({ error: { message: '  Not\n allowed  ' } }))).toBe('Not allowed')
    expect(googleReason(JSON.stringify({ error: { message: 'x'.repeat(500) } }))!.length).toBe(200)
    expect(googleReason('<html>Bad gateway</html>')).toBeNull()
    expect(googleReason('{"error":{}}')).toBeNull()
  })

  it('fall back to the status when the body has none', async () => {
    const { timers } = { timers: { set: () => 0, clear: () => undefined, now: () => 1 } satisfies SyncTimers }
    const sync = new GoogleCalendarSync(await signedIn(), undefined, timers)
    state.failNext = { status: 400, count: 1, body: 'not json' }
    await sync.request({ windowStart: '2026-11-01', events: [ev('a', '2026-11-18')] })
    expect(sync.status().lastError).toBe('Google Calendar refused the change (400).')
  })
})
