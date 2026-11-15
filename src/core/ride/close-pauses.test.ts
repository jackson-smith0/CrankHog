import { describe, expect, it } from 'vitest'
import type { RideRecord } from './recorder'
import { closePauses } from './close-pauses'

const T0 = Date.UTC(2026, 10, 15, 14, 51, 0)

/** One record per entry: [power, cadence], or 'gap:<s>' for a pause of that many seconds before the next record. */
function build(spec: ([number | null, number | null] | `gap:${number}`)[]): RideRecord[] {
  const out: RideRecord[] = []
  let ts = T0
  for (const s of spec) {
    if (typeof s === 'string') {
      ts += Number(s.slice(4)) * 1000
      continue
    }
    ts += 1000
    out.push({
      t: out.length, ts, power: s[0], cadence: s[1], hr: 130, speed: null, distance: out.length * 8, altitude: null, grade: null,
      targetW: null, lrBalance: null, coreTemp: null, skinTemp: null, smo2: null, lap: 0, rr: [],
    })
  }
  return out
}

const ride = (n: number, w = 200): [number, number][] => Array.from({ length: n }, () => [w, 90])
const zeros = (n: number): [number, number][] => Array.from({ length: n }, () => [0, 0])
const silent = (n: number): [null, null][] => Array.from({ length: n }, () => [null, null])

describe('closePauses', () => {
  it('closes pauses into one contiguous ride from the first record', () => {
    const records = build([...ride(20), ...zeros(3), 'gap:1500', ...ride(20)])
    const out = closePauses(records)
    expect(out).toHaveLength(43)
    expect(out.map((r) => r.t)).toEqual(Array.from({ length: 43 }, (_, i) => i))
    expect(out[0]!.ts).toBe(records[0]!.ts)
    expect(out.slice(1).every((r, i) => r.ts - out[i]!.ts === 1000)).toBe(true)
  })

  it('keeps every second the ride clock counted: zeros, silence and seconds with no power or cadence at all', () => {
    // standing still after a manual start, the zeros that set off an auto-pause, the silence before a sensor-lost pause
    const records = build([...zeros(4), ...ride(10), ...zeros(3), 'gap:60', ...silent(30), 'gap:60', ...ride(5)])
    const out = closePauses(records)
    expect(out.map(({ power, cadence, hr, distance, lap }) => ({ power, cadence, hr, distance, lap }))).toEqual(
      records.map(({ power, cadence, hr, distance, lap }) => ({ power, cadence, hr, distance, lap })),
    )
  })

  it('changes nothing but the timestamps, so laps and positions stay on their seconds', () => {
    const records = build([...ride(3), 'gap:30', ...ride(3)])
    records[4]!.lap = 1
    records[4]!.lat = 46.5
    records[4]!.lon = 7.9
    const out = closePauses(records)
    expect(out[4]).toEqual({ ...records[4], ts: records[2]!.ts + 2000 })
  })

  it('returns nothing for nothing', () => {
    expect(closePauses([])).toEqual([])
  })
})
