// Scheduled workouts in IndexedDB. What a scheduled workout is, and when it
// counts as done, is in @core/workout/schedule.
import type { DateKey, ScheduledWorkout } from '@core/workout/schedule'
import { db } from '../db/db'

const newId = () => `s${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`

/** Scheduled workouts from `from` to `to` (both included), in date order. */
export async function listScheduled(from: DateKey, to: DateKey): Promise<ScheduledWorkout[]> {
  const list = await db().schedule.where('date').between(from, to, true, true).toArray()
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

/** Puts a library workout on a day. */
export async function scheduleWorkout(date: DateKey, workout: { id: string; name: string }): Promise<ScheduledWorkout> {
  const entry: ScheduledWorkout = { id: newId(), date, workoutId: workout.id, workout: null, name: workout.name, source: 'manual', createdAt: Date.now() }
  await db().schedule.put(entry)
  return entry
}

export async function moveScheduled(id: string, date: DateKey): Promise<void> {
  await db().schedule.update(id, { date })
}

export async function removeScheduled(id: string): Promise<void> {
  await db().schedule.delete(id)
}

/**
 * Brings the schedule in line with an intervals.icu import of `from`..`to`:
 * workouts imported before in that range are updated (moved, renamed,
 * changed), added or, when gone from intervals.icu, removed. The rider's own
 * entries, and imports outside the range, are left alone.
 */
export async function replaceIntervalsImports(from: DateKey, to: DateKey, entries: readonly ScheduledWorkout[]): Promise<{ added: number; updated: number; removed: number }> {
  const d = db()
  return d.transaction('rw', d.schedule, async () => {
    const before = (await d.schedule.where('date').between(from, to, true, true).toArray()).filter((e) => e.source === 'intervals')
    const incoming = new Set(entries.map((e) => e.id))
    const existing = new Map((await d.schedule.bulkGet(entries.map((e) => e.id))).filter((e): e is ScheduledWorkout => !!e).map((e) => [e.id, e]))
    const gone = before.filter((e) => !incoming.has(e.id))
    await d.schedule.bulkDelete(gone.map((e) => e.id))
    // keep when it was first imported, so its place among the day's workouts holds
    await d.schedule.bulkPut(entries.map((e) => ({ ...e, createdAt: existing.get(e.id)?.createdAt ?? e.createdAt })))
    return { added: entries.length - existing.size, updated: existing.size, removed: gone.length }
  })
}
