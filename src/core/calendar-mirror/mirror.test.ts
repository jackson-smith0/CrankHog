import { describe, expect, it } from 'vitest'
import { allDayEnd, diffMirror, fingerprint, googleEventId, mirrorWindowStart, type MirrorEvent, type MirroredEvent } from './mirror'

const ev = (key: string, date: string, title = `Workout ${key}`): MirrorEvent => ({ key, date, title, description: 'Ride · 1 h' })
const mirrored = (e: MirrorEvent, eventId = googleEventId(e.key), over: Partial<MirroredEvent> = {}): MirroredEvent => ({ eventId, date: e.date, key: e.key, fingerprint: fingerprint(e), ...over })

describe('Google event ids', () => {
  it('are base32hex, 5 to 1024 characters, and the same for the same entry', () => {
    for (const key of ['s1', 'smhx0k2ab12cd34', 'intervals:12345', 'Plan item ★ 7']) {
      const id = googleEventId(key)
      expect(id).toMatch(/^[a-v0-9]{5,1024}$/)
      expect(googleEventId(key)).toBe(id)
    }
    expect(googleEventId('a')).not.toBe(googleEventId('b'))
    expect(googleEventId('x'.repeat(200)).length).toBeLessThanOrEqual(1024)
  })
})

describe('fingerprints', () => {
  it('change with the day, the title or the description', () => {
    const base = ev('a', '2026-11-18')
    expect(fingerprint({ ...base })).toBe(fingerprint(base))
    expect(fingerprint({ ...base, date: '2026-11-19' })).not.toBe(fingerprint(base))
    expect(fingerprint({ ...base, title: 'Other' })).not.toBe(fingerprint(base))
    expect(fingerprint({ ...base, description: 'Run' })).not.toBe(fingerprint(base))
  })
})

describe('the mirror window', () => {
  it('reaches 30 days back, and all-day events end the next day', () => {
    expect(mirrorWindowStart('2026-11-16')).toBe('2026-10-17')
    expect(allDayEnd('2026-12-31')).toBe('2027-01-01')
  })
})

describe('diffMirror', () => {
  const start = '2026-11-01'

  it('adds what is new, leaves what is unchanged, and removes what went', () => {
    const keep = ev('keep', '2026-11-18')
    const gone = ev('gone', '2026-11-19')
    const fresh = ev('fresh', '2026-11-20')
    const d = diffMirror([keep, fresh], [mirrored(keep), mirrored(gone)], start)
    expect(d.insert).toEqual([fresh])
    expect(d.update).toEqual([])
    expect(d.delete).toEqual([googleEventId('gone')])
  })

  it('moves an event when its entry moves, and renames it when it is renamed', () => {
    const before = ev('a', '2026-11-18')
    const moved = { ...before, date: '2026-11-21' }
    expect(diffMirror([moved], [mirrored(before)], start).update).toEqual([{ eventId: googleEventId('a'), event: moved }])
    const renamed = { ...before, title: 'Threshold 2×20' }
    expect(diffMirror([renamed], [mirrored(before)], start).update).toEqual([{ eventId: googleEventId('a'), event: renamed }])
  })

  it('puts an event dragged in Google back on its CrankHog day', () => {
    const e = ev('a', '2026-11-18')
    const dragged = mirrored(e, googleEventId('a'), { date: '2026-11-25' })
    expect(diffMirror([e], [dragged], start).update).toEqual([{ eventId: googleEventId('a'), event: e }])
  })

  it('finds events by key, whatever id Google gave them', () => {
    const e = ev('a', '2026-11-18')
    expect(diffMirror([e], [mirrored(e, 'googlechose123')], start)).toEqual({ insert: [], update: [], delete: [] })
  })

  it('never touches events the rider added, or anything before the window', () => {
    const old = ev('old', '2026-10-02')
    const theirs: MirroredEvent = { eventId: 'theirs1', date: '2026-11-18', key: null, fingerprint: null }
    const d = diffMirror([], [mirrored(old), theirs], start)
    expect(d).toEqual({ insert: [], update: [], delete: [] })
    expect(diffMirror([old], [], start).insert).toEqual([])
  })

  it('removes a duplicate event for the same entry, and sends a repeated entry once', () => {
    const e = ev('a', '2026-11-18')
    const d = diffMirror([e, e], [mirrored(e), mirrored(e, 'dupe')], start)
    expect(d).toEqual({ insert: [], update: [], delete: ['dupe'] })
  })
})
