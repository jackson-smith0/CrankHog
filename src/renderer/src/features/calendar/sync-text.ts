// What an intervals.icu activity sync did, in words, for the Calendar and Settings.
import type { ActivitySyncResult } from '../../plan/intervals-activities'

/** What a sync did, for the notice. */
export function describeSync(r: Pick<ActivitySyncResult, 'added' | 'updated' | 'removed' | 'fromStrava'>): string {
  const parts: string[] = []
  if (r.added) parts.push(`${r.added} new activit${r.added === 1 ? 'y' : 'ies'} from intervals.icu`)
  if (r.updated) parts.push(`${r.updated} updated`)
  if (r.removed) parts.push(`${r.removed} removed`)
  const head = parts.length > 0 ? `${parts.join(', ')}.` : 'Your calendar has everything intervals.icu has.'
  return r.fromStrava > 0 ? `${head} ${stravaHint(r.fromStrava)}` : head
}

/** Why some activities didn't come, and what to do about it. */
export const stravaHint = (n: number) =>
  `${n} activit${n === 1 ? 'y' : 'ies'} came to intervals.icu from Strava, which it can't share. Connect Garmin to intervals.icu directly (on intervals.icu: Settings, Connections) to bring them in.`

