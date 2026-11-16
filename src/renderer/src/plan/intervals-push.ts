// Planned runs, swims and other sessions sent to the rider's intervals.icu
// calendar, which reads the steps and, if the rider allows it there, puts
// the workout on their Garmin. A session sent once follows changes made
// here: moved, it moves there; removed, it goes there too.
import { INTERVALS_TYPE } from '@core/sport/group'
import { entrySport, isBikeWorkout, pushedExternalId, type PushedChanges } from '@core/workout/schedule'
import { db } from '../db/db'
import { bridge } from '../platform/bridge'

/** Sends a planned session to intervals.icu, or sends it again after a change. Returns the intervals.icu event id. */
export async function sendToIntervals(entryId: string): Promise<string> {
  const e = await db().schedule.get(entryId)
  if (!e) throw new Error('That session is no longer on the calendar.')
  if (isBikeWorkout(e)) throw new Error('Bike workouts are ridden here, so only runs, swims and other sessions are sent.')
  const sport = entrySport(e)
  const description = e.session?.text ?? e.session?.notes ?? ''
  const { eventId } = await bridge().invoke('intervals.putWorkout', {
    ...(e.pushedEventId ? { eventId: e.pushedEventId } : {}),
    workout: {
      date: e.date,
      type: INTERVALS_TYPE[sport] as 'Ride' | 'Run' | 'Swim' | 'Workout',
      name: e.name,
      description,
      externalId: pushedExternalId(e.id),
      movingTimeS: e.session?.durationS ?? null,
      load: e.session?.load ?? null,
    },
  })
  await db().schedule.update(e.id, { pushedEventId: eventId })
  return eventId
}

/**
 * Brings intervals.icu in line after sent sessions moved or went here. Best
 * effort: without a connection the change waits for the next send, and is
 * never a reason to refuse the change here.
 */
export async function followPushed(changes: PushedChanges): Promise<void> {
  for (const m of changes.moved) {
    try {
      await sendToIntervals(m.entryId)
    } catch {
      // offline, or the key was removed: the next send catches up
    }
  }
  for (const r of changes.removed) {
    try {
      await bridge().invoke('intervals.deleteWorkout', { eventId: r.eventId })
    } catch {
      // as above
    }
  }
}
