// Dead time out of a finished ride, before it is saved, exported or uploaded.
//
// A ride is a run of moving blocks separated by pauses (a jump of more than a
// second between record timestamps). Each block can start and end with dead
// seconds: no power and no cadence, while the rider was getting going, or in
// the seconds that set off an auto-pause (3 s of zeros, or 30 s of silence).
// Those edges go; dead seconds inside a block (a few seconds of coasting)
// stay, so NP and TSS still see them.
//
// What is left is re-timed into one contiguous ride starting at its first
// kept second, so elapsed time equals moving time in the history, the FIT
// file and every platform it is uploaded to. The journal keeps the raw seconds.
import type { RideRecord } from './recorder'

const isDead = (r: RideRecord): boolean => (r.power === null || r.power === 0) && (r.cadence === null || r.cadence === 0)

export function trimDeadTime(records: RideRecord[]): RideRecord[] {
  const kept: RideRecord[] = []
  let start = 0
  for (let i = 1; i <= records.length; i++) {
    if (i < records.length && records[i]!.ts - records[i - 1]!.ts <= 1000) continue
    // records[start..i) is one moving block
    let a = start
    let b = i - 1
    while (a <= b && isDead(records[a]!)) a++
    while (b >= a && isDead(records[b]!)) b--
    for (let k = a; k <= b; k++) kept.push(records[k]!)
    start = i
  }
  if (kept.length === 0) return []
  const firstTs = kept[0]!.ts
  return kept.map((r, i) => ({ ...r, t: i, ts: firstTs + i * 1000 }))
}
