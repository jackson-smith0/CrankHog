// Everything the Calendar shows for a stretch of days, live from IndexedDB:
// rides, other sports, planned workouts (with their length and TSS at the
// rider's FTP, and their shapes for the cards), events and days off.
import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { projectPmc, type ProjectedPmcRow } from '@core/metrics/pmc'
import { dailyLoad } from '@core/sport/daily-load'
import { activityGroup } from '@core/sport/group'
import { activityLoad } from '@core/sport/load'
import { completions, dateKey, entrySport, isBikeWorkout, plannedWorkoutId, type DateKey, type ScheduledWorkout } from '@core/workout/schedule'
import type { VolumeInput } from '@core/workout/volume'
import { db } from '../../db/db'
import { useFtp } from '../../db/use-athlete'
import { listScheduled } from '../../plan/schedule-repo'
import { describeWorkout, loadLibrary, plannedStatsOf } from '../../workouts/library'
import { previewsFor } from './preview'

export interface PlannedStats {
  durationS: number | null
  tss: number | null
  distanceM?: number | null
}

/**
 * Length and TSS of each scheduled workout at `ftpW`: its library entry, or
 * the workout it carries. A session of another sport (or a ride without a
 * workout) has what was planned for it.
 */
export function plannedStats(schedule: readonly ScheduledWorkout[], library: ReadonlyMap<string, PlannedStats>, ftpW: number): Map<string, PlannedStats> {
  const out = new Map<string, PlannedStats>()
  for (const e of schedule) {
    if (!isBikeWorkout(e)) {
      out.set(e.id, { durationS: e.session?.durationS ?? null, tss: e.session?.load ?? null, distanceM: e.session?.distanceM ?? null })
    } else if (e.workout) {
      out.set(e.id, plannedStatsOf(e.workout, describeWorkout(e.workout, ftpW).stats))
    } else {
      const id = plannedWorkoutId(e)
      out.set(e.id, (id && library.get(id)) || { durationS: null, tss: null })
    }
  }
  return out
}

export function useCalendarData(from: number, to: number, today: DateKey) {
  const fromKey = dateKey(from)
  const toKey = dateKey(to)
  const rides = useLiveQuery(() => db().rides.where('startedAt').between(from, to).toArray(), [from, to])
  const schedule = useLiveQuery(() => listScheduled(fromKey, toKey), [fromKey, toKey])
  const activities = useLiveQuery(() => db().activities.where('startedAt').between(from, to).toArray(), [from, to])
  const marks = useLiveQuery(() => db().dayMarks.where('date').between(fromKey, toKey, true, true).toArray(), [fromKey, toKey])
  const plans = useLiveQuery(() => db().plans.toArray(), [])
  // fitness needs every ride and other sport before the grid, and every workout planned from today to its end
  const history = useLiveQuery(async () => {
    const [allRides, others] = await Promise.all([db().rides.toArray(), db().activities.toArray()])
    return dailyLoad({ rides: allRides, activities: others.map((a) => ({ startedAt: a.startedAt, load: activityLoad(a) })) })
  }, [])
  const ahead = useLiveQuery(() => (toKey > today ? listScheduled(today, toKey) : Promise.resolve([])), [today, toKey])
  const { ftpW } = useFtp()
  const library = useLiveQuery(() => loadLibrary(ftpW), [ftpW])

  const stats = useMemo(() => {
    const byId = new Map((library ?? []).map((e) => [e.workout.id, plannedStatsOf(e.workout, e.stats)]))
    return plannedStats(schedule ?? [], byId, ftpW)
  }, [schedule, library, ftpW])

  /** What volumeBetween needs, for any week or month in range. */
  const volumeInput = useMemo((): Omit<VolumeInput, 'today'> => {
    const s = schedule ?? []
    const r = rides ?? []
    const done = completions(
      s,
      r.map((x) => ({ id: x.id, startedAt: x.startedAt, workoutId: x.workoutId, simulated: x.simulated })),
      (activities ?? []).map((a) => ({ id: a.id, startedAt: a.startedAt, group: activityGroup(a) })),
    )
    return {
      planned: s.map((e) => ({ date: e.date, durationS: stats.get(e.id)?.durationS ?? null, load: stats.get(e.id)?.tss ?? null, done: done.has(e.id), sport: entrySport(e), distanceM: stats.get(e.id)?.distanceM ?? null })),
      rides: r.map((x) => ({ startedAt: x.startedAt, movingS: x.movingS, tss: x.tss, simulated: x.simulated, distanceM: x.distanceM })),
      activities: (activities ?? []).map((a) => ({ startedAt: a.startedAt, movingS: a.movingS, load: activityLoad(a), sport: activityGroup(a), distanceM: a.distanceM })),
    }
  }, [schedule, rides, activities, stats])

  /** Each planned workout's shape, length and average watts, by workout id. */
  const previews = useMemo(() => previewsFor(library ?? [], schedule ?? [], ftpW), [library, schedule, ftpW])

  const planNames = useMemo(() => new Map((plans ?? []).map((p) => [p.id, p.name])), [plans])

  /** Fitness, fatigue and form on each day of the grid: from rides up to today, projected from planned workouts after it. */
  const fitness = useMemo((): Map<DateKey, ProjectedPmcRow> => {
    if (!history || history.length === 0) return new Map()
    const byId = new Map((library ?? []).map((e) => [e.workout.id, plannedStatsOf(e.workout, e.stats)]))
    const upcoming = (ahead ?? []).filter((e) => e.date > today)
    const aheadStats = plannedStats(upcoming, byId, ftpW)
    const planned = upcoming.map((e) => ({ date: e.date, tss: aheadStats.get(e.id)?.tss ?? 0 }))
    return new Map(projectPmc(history, planned, { today, from: fromKey, to: toKey }).map((r) => [r.date, r]))
  }, [history, ahead, library, ftpW, today, fromKey, toKey])

  return { rides, schedule, activities, marks, stats, volumeInput, planNames, previews, fitness, loaded: rides !== undefined && schedule !== undefined && activities !== undefined }
}
