import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SecretStore, type Cipher } from '../secrets/secret-store'
import { IntervalsClient } from './intervals'

const plainCipher: Cipher = { isAvailable: () => true, encrypt: (s) => Buffer.from(s, 'utf8'), decrypt: (b) => b.toString('utf8') }
const ZWO = '<workout_file><name>Tempo</name><workout><SteadyState Duration="600" Power="0.8"/></workout></workout_file>'

let server: Server | null = null
afterEach(() => server?.close())

/** A stand-in intervals.icu that answers the events call with `events`, and records what it was asked. */
async function fakeIntervals(events: unknown) {
  const seen: { path: string; query: URLSearchParams; auth: string }[] = []
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    seen.push({ path: url.pathname, query: url.searchParams, auth: String(req.headers.authorization) })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(events))
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/v1`
  const client = new IntervalsClient(SecretStore.inDir(mkdtempSync(join(tmpdir(), 'crankhog-intervals-')), plainCipher), base)
  return { client, seen }
}

describe('intervals.icu planned workouts', () => {
  it('asks for the workouts on the calendar in a date range, with the workout as a Zwift file', async () => {
    const { client, seen } = await fakeIntervals([
      { id: 11, start_date_local: '2026-11-18T00:00:00', name: 'Tempo', type: 'Ride', category: 'WORKOUT', description: '- 10m 80%', workout_file_base64: Buffer.from(ZWO).toString('base64'), workout_filename: 'Tempo.zwo' },
    ])
    client.configure({ apiKey: 'secret-key-123', athleteId: 'i42' })
    const events = await client.plannedWorkouts('2026-11-14', '2026-11-27')
    expect(seen[0]!.path).toBe('/api/v1/athlete/i42/events')
    expect(Object.fromEntries(seen[0]!.query)).toEqual({ oldest: '2026-11-14', newest: '2026-11-27', category: 'WORKOUT', ext: 'zwo' })
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from('API_KEY:secret-key-123').toString('base64')}`)
    expect(events).toEqual([{ id: '11', start_date_local: '2026-11-18T00:00:00', name: 'Tempo', type: 'Ride', description: '- 10m 80%', zwo: ZWO, external_id: null, moving_time: null, icu_training_load: null }])
  })

  it('drops events that are not workouts or are malformed, and passes on rides without a file', async () => {
    const { client } = await fakeIntervals([
      { id: 1, start_date_local: '2026-11-18T00:00:00', name: 'Note', category: 'NOTE' },
      { id: 2, name: 'No date', category: 'WORKOUT' },
      'nonsense',
      { id: 3, start_date_local: '2026-11-19T00:00:00', name: 'Text only', type: 'VirtualRide', category: 'WORKOUT', description: '- 20m 60%' },
    ])
    client.configure({ apiKey: 'secret-key-123', athleteId: '0' })
    expect(await client.plannedWorkouts('2026-11-14', '2026-11-27')).toEqual([{ id: '3', start_date_local: '2026-11-19T00:00:00', name: 'Text only', type: 'VirtualRide', description: '- 20m 60%', zwo: null, external_id: null, moving_time: null, icu_training_load: null }])
  })

  it('refuses without a key, or for a range of more than a few months', async () => {
    const { client, seen } = await fakeIntervals([])
    await expect(client.plannedWorkouts('2026-11-14', '2026-11-27')).rejects.toThrow(/not configured/)
    client.configure({ apiKey: 'secret-key-123', athleteId: '0' })
    await expect(client.plannedWorkouts('2026-01-01', '2026-12-31')).rejects.toThrow(/range/)
    expect(seen).toHaveLength(0)
  })
})

describe('intervals.icu activities', () => {
  const garminRun = { id: 'i101', start_date_local: '2026-11-18T07:00:00', start_date: '2026-11-18T15:00:00Z', type: 'Run', name: 'Morning Run', moving_time: 2400, distance: 8000, average_heartrate: 150, max_heartrate: 172, icu_training_load: 52, source: 'GARMIN_CONNECT', external_id: null, icu_ftp: 250 }

  it('asks for activities in a date range and trims each one', async () => {
    const { client, seen } = await fakeIntervals([garminRun])
    client.configure({ apiKey: 'secret-key-123', athleteId: 'i42' })
    const res = await client.activities('2026-11-04', '2026-11-18')
    expect(seen[0]!.path).toBe('/api/v1/athlete/i42/activities')
    expect(Object.fromEntries(seen[0]!.query)).toEqual({ oldest: '2026-11-04', newest: '2026-11-18' })
    expect(res).toEqual({
      fromStrava: 0,
      activities: [{ id: 'i101', start_date_local: '2026-11-18T07:00:00', start_date: '2026-11-18T15:00:00Z', type: 'Run', name: 'Morning Run', moving_time: 2400, distance: 8000, average_heartrate: 150, max_heartrate: 172, icu_training_load: 52, source: 'GARMIN_CONNECT', external_id: null }],
    })
  })

  it('counts activities from Strava without passing them on, and drops malformed ones', async () => {
    const { client } = await fakeIntervals([
      { id: 'i1', start_date_local: '2026-11-18T07:00:00', type: 'Run', source: 'STRAVA', _note: 'STRAVA activities are not available via the API' },
      { id: 'i2', start_date_local: '2026-11-18T09:00:00', type: 'Ride' },
      { id: 'i3', name: 'No date', moving_time: 60 },
      { ...garminRun, id: 'i4', average_heartrate: 900, distance: -5, name: 'x'.repeat(400) },
      42,
    ])
    client.configure({ apiKey: 'secret-key-123', athleteId: '0' })
    const res = await client.activities('2026-11-04', '2026-11-18')
    expect(res.fromStrava).toBe(2)
    expect(res.activities).toHaveLength(1)
    expect(res.activities[0]).toMatchObject({ id: 'i4', average_heartrate: null, distance: null, name: '' })
  })

  it('refuses without a key, or for too long a range', async () => {
    const { client, seen } = await fakeIntervals([])
    await expect(client.activities('2026-11-14', '2026-11-27')).rejects.toThrow(/not configured/)
    client.configure({ apiKey: 'secret-key-123', athleteId: '0' })
    await expect(client.activities('2026-01-01', '2026-12-31')).rejects.toThrow(/range/)
    expect(seen).toHaveLength(0)
  })
})

describe('intervals.icu planned workouts sent from CrankHog', () => {
  /** A stand-in that records each request with its body, and answers with `reply(method, path)`. */
  async function fakeEvents(reply: (method: string, path: string) => { status?: number; body?: unknown }) {
    const seen: { method: string; path: string; body: unknown }[] = []
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c: Buffer) => (raw += c.toString()))
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        seen.push({ method: req.method ?? '', path: url.pathname, body: raw ? JSON.parse(raw) : null })
        const r = reply(req.method ?? '', url.pathname)
        res.statusCode = r.status ?? 200
        res.setHeader('content-type', 'application/json')
        res.end(r.body === undefined ? '' : JSON.stringify(r.body))
      })
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/v1`
    const client = new IntervalsClient(SecretStore.inDir(mkdtempSync(join(tmpdir(), 'crankhog-intervals-')), plainCipher), base)
    client.configure({ apiKey: 'secret-key-123', athleteId: 'i42' })
    return { client, seen }
  }
  const run = { date: '2026-12-02', type: 'Run', name: 'Threshold 4x8', description: 'Warmup\n- 15m Z2 HR', externalId: 'freegaz-plan-s1', movingTimeS: 3900, load: 91.5 }

  it('creates the event with the steps as its description and CrankHog’s external id', async () => {
    const { client, seen } = await fakeEvents(() => ({ body: { id: 777 } }))
    expect(await client.putPlannedWorkout(run)).toEqual({ eventId: '777' })
    expect(seen).toEqual([
      {
        method: 'POST',
        path: '/api/v1/athlete/i42/events',
        body: { category: 'WORKOUT', start_date_local: '2026-12-02T00:00:00', type: 'Run', name: 'Threshold 4x8', description: 'Warmup\n- 15m Z2 HR', external_id: 'freegaz-plan-s1', moving_time: 3900, icu_training_load: 92 },
      },
    ])
  })

  it('updates the event sent before, and creates it again when it was deleted on intervals.icu', async () => {
    const { client, seen } = await fakeEvents((method) => (method === 'PUT' ? { status: 404, body: { error: 'not found' } } : { body: { id: 778 } }))
    expect(await client.putPlannedWorkout({ ...run, date: '2026-12-03' }, '777')).toEqual({ eventId: '778' })
    expect(seen.map((s) => [s.method, s.path])).toEqual([
      ['PUT', '/api/v1/athlete/i42/events/777'],
      ['POST', '/api/v1/athlete/i42/events'],
    ])
  })

  it('deletes the event, and takes one already gone as done', async () => {
    const { client, seen } = await fakeEvents(() => ({ status: 404 }))
    await client.deletePlannedWorkout('777')
    expect(seen.map((s) => [s.method, s.path])).toEqual([['DELETE', '/api/v1/athlete/i42/events/777']])
  })

  it('passes on any other failure', async () => {
    const { client } = await fakeEvents(() => ({ status: 500 }))
    await expect(client.putPlannedWorkout(run)).rejects.toThrow(/500/)
    await expect(client.deletePlannedWorkout('777')).rejects.toThrow(/500/)
  })
})
