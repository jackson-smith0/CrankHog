// Pauses out of a finished ride, before it is saved, exported or uploaded.
//
// Records are one per second of moving time, so a pause shows up only as a
// jump of more than a second between two records' timestamps. Re-timing the
// records into one contiguous ride from the first one closes those jumps, so
// elapsed time equals moving time in the history, the FIT file and every
// platform it is uploaded to (Strava counts a FIT's pauses as elapsed time).
//
// No record is dropped: every second the ride clock counted stays, so the
// saved ride, its laps and a workout's intervals are as long as the rider saw
// them. The journal keeps the raw timestamps.
import type { RideRecord } from './recorder'

export function closePauses(records: RideRecord[]): RideRecord[] {
  const first = records[0]
  if (!first) return []
  return records.map((r, i) => ({ ...r, t: i, ts: first.ts + i * 1000 }))
}
