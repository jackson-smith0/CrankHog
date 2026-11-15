import { describe, expect, it } from 'vitest'
import type { RideRecord } from './recorder'
import { trimDeadTime } from './trim'

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

describe('trimDeadTime', () => {
  it('drops dead seconds at the start and end of the ride', () => {
    const out = trimDeadTime(build([...zeros(4), ...ride(10), ...zeros(3)]))
    expect(out).toHaveLength(10)
    expect(out.every((r) => r.power === 200)).toBe(true)
  })

  it('closes pauses and drops the zeros that set off an auto-pause', () => {
    const records = build([...ride(20), ...zeros(3), 'gap:1500', ...ride(20)])
    const out = trimDeadTime(records)
    expect(out).toHaveLength(40)
    // one contiguous ride: re-indexed, one second apart, starting at the first kept second
    expect(out.map((r) => r.t)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    expect(out[0]!.ts).toBe(records[0]!.ts)
    expect(out.slice(1).every((r, i) => r.ts - out[i]!.ts === 1000)).toBe(true)
  })

  it('drops the silence before a sensor-lost pause', () => {
    expect(trimDeadTime(build([...ride(30), ...silent(30), 'gap:60', ...ride(30)]))).toHaveLength(60)
  })

  it('keeps coasting inside a moving block, so NP and TSS still count it', () => {
    const out = trimDeadTime(build([...ride(10), ...zeros(2), [0, 40], ...ride(10)]))
    expect(out).toHaveLength(23)
    expect(out.filter((r) => r.power === 0)).toHaveLength(3)
  })

  it('keeps a second with cadence but no power reading', () => {
    expect(trimDeadTime(build([[null, 85], ...ride(5)]))).toHaveLength(6)
  })

  it('keeps everything else each record carried', () => {
    const records = build([...zeros(2), ...ride(3)])
    records[3]!.lap = 2
    const out = trimDeadTime(records)
    expect(out[1]).toEqual({ ...records[3], t: 1, ts: records[2]!.ts + 1000 })
  })

  it('returns nothing for a ride that never got going', () => {
    expect(trimDeadTime(build([...zeros(5), 'gap:30', ...silent(5)]))).toEqual([])
    expect(trimDeadTime([])).toEqual([])
  })
})
