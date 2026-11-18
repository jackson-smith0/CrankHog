// Applying a change the coach proposed in the chat (src/core/ai/calendar-edits.ts),
// once the rider presses Apply, and undoing it.
//
// A change applies to that day only. A manual entry takes the new session
// as its own snapshot (a ride, as a new library workout). A plan's entry is
// rebuilt from the library whenever the plan is re-laid, so its new session
// goes into a new library workout tagged "coach", and only that plan item is
// pointed at it: other days with the old workout keep it. Moves and removals
// go the way a drag or the planned workout dialog does.
//
// What apply returns is the undo, as plain data so the chat can keep it.
import { resolveEdit, withSessionHeader, type CalendarEdit, type EditContent, type EditResolve } from '@core/ai/calendar-edits'
import type { SessionThresholds } from '@core/multisport/estimate'
import type { SessionSport, SessionWorkout } from '@core/multisport/model'
import { activityGroup, SPORT_GROUP_LABEL, type SportGroup } from '@core/sport/group'
import { effortLoad } from '@core/sport/load'
import type { PlanItem } from '@core/workout/plan'
import { completions, dateKey, isBikeWorkout, type PlannedSession, type ScheduledWorkout } from '@core/workout/schedule'
import type { Workout } from '@core/workout/model'
import { currentFtp, DEFAULT_FTP_W } from '../db/athlete-repo'
import { db } from '../db/db'
import { describeWorkout, getWorkout, plannedStatsOf, saveWorkout } from '../workouts/library'
import { getSessionWorkout, plannedFrom, saveSessionWorkout, sessionThresholds } from '../workouts/sessions-repo'
import { followPushed, sendToIntervals } from './intervals-push'
import { planItem, replacePlanWorkout, restorePlanItem } from './plans-repo'
import { moveScheduled, removeScheduled, scheduleSession, scheduleWorkout } from './schedule-repo'

/** Library workouts a change made, so an undo can take them away again. */
interface Created {
  workoutId?: string
  sessionWorkoutId?: string
}

/** How to put a change back. */
export type CoachUndo =
  /** A manual entry: `before` is the row as it was (null when the change added it), `after` as the change left it (null when it removed it). */
  | { kind: 'entry'; entryId: string; before: ScheduledWorkout | null; after: ScheduledWorkout | null; created?: Created }
  /** A plan's entry: its plan item before and after. */
  | { kind: 'plan'; planId: string; before: PlanItem; after: PlanItem; created?: Created }

const UNDO_STALE = 'That session has changed since, so this change can no longer be undone.'

/** Today's calendar, and which entries are done, as resolveEdit wants them. */
async function calendarNow(): Promise<{ schedule: ScheduledWorkout[]; done: Map<string, string>; today: string }> {
  const d = db()
  const [schedule, rides, activities] = await Promise.all([d.schedule.toArray(), d.rides.toArray(), d.activities.toArray()])
  const done = completions(
    schedule,
    rides.map((r) => ({ id: r.id, startedAt: r.startedAt, workoutId: r.workoutId, simulated: r.simulated })),
    activities.map((a) => ({ id: a.id, startedAt: a.startedAt, group: activityGroup(a) })),
  )
  return { schedule, done, today: dateKey(Date.now()) }
}

/** An edit checked against the calendar as it is right now. */
export async function resolveNow(edit: CalendarEdit): Promise<EditResolve> {
  const { schedule, done, today } = await calendarNow()
  return resolveEdit(edit, schedule, done, today)
}

const newWorkoutId = () => `user:${crypto.randomUUID()}`
const newSessionId = () => `session-coach:${crypto.randomUUID()}`

/** A run, swim or other session as a library workout of its own. */
function sessionWorkoutOf(content: Extract<EditContent, { kind: 'session' }>, name: string): SessionWorkout {
  const now = Date.now()
  const h = content.parsed.header
  return {
    id: newSessionId(),
    sport: content.sport,
    name,
    text: content.file,
    tags: ['coach'],
    source: 'user',
    ...(h.pool ? { pool: h.pool } : {}),
    ...(h.durationS !== undefined ? { durationS: h.durationS } : {}),
    ...(h.distanceM !== undefined ? { distanceM: h.distanceM } : {}),
    ...(h.effort ? { effort: h.effort } : {}),
    ...(h.notes ? { notes: h.notes } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

/** What a session snapshot on a manual entry carries, without a library copy. */
function snapshotOf(w: SessionWorkout, thresholds: SessionThresholds): PlannedSession {
  const { sessionWorkoutId: _id, ...session } = plannedFrom(w, thresholds)
  return session
}

async function saveBikeCopy(w: Workout, name: string, notes?: string): Promise<Workout> {
  const ftpW = (await currentFtp())?.ftpW ?? DEFAULT_FTP_W
  const { createdAt: _c, updatedAt: _u, folder: _f, planId: _p, ...rest } = structuredClone(w)
  return saveWorkout({ ...rest, id: newWorkoutId(), name, ...(notes !== undefined ? { description: notes } : {}), source: 'ai', tags: [...new Set([...rest.tags, 'coach'])] }, ftpW)
}

/** The row without the fields a sport or kind of session doesn't have. */
function bare(e: ScheduledWorkout): ScheduledWorkout {
  const { sport: _s, session: _x, ...rest } = e
  return { ...rest, workoutId: null, workout: null }
}

/** After an entry's content changed: a session sent to intervals.icu is sent again; one that became a ride, which isn't sent, is taken off there. */
async function followContent(entryId: string): Promise<void> {
  const e = await db().schedule.get(entryId)
  if (!e?.pushedEventId) return
  try {
    if (!isBikeWorkout(e)) await sendToIntervals(entryId)
    else {
      await followPushed({ moved: [], removed: [{ eventId: e.pushedEventId }] })
      const { pushedEventId: _p, ...rest } = e
      await db().schedule.put(rest)
    }
  } catch {
    // best effort, as with moves: the change here stands
  }
}

/** Applies a change the rider accepted. Resolve it first (resolveNow); this checks again, in case the calendar moved on. */
export async function applyCoachEdit(resolved: EditResolve): Promise<CoachUndo> {
  if (!resolved.ok) throw new Error(resolved.problem)
  const again = await resolveNow(resolved.edit)
  if (!again.ok) throw new Error(again.problem)
  const { edit, entry, sport } = again

  if (edit.action === 'add') return add(again)
  if (!entry) throw new Error("That session isn't on the calendar any more.")
  const fromPlan = entry.planId && entry.planItemId ? await planItem(entry.planId, entry.planItemId) : undefined

  if (edit.action === 'move' || edit.action === 'remove') {
    if (edit.action === 'move') await moveScheduled(entry.id, edit.date!)
    else await removeScheduled(entry.id)
    const after = fromPlan ? await planItem(entry.planId!, fromPlan.id) : undefined
    if (fromPlan && after) return { kind: 'plan', planId: entry.planId!, before: fromPlan, after }
    return { kind: 'entry', entryId: entry.id, before: entry, after: (await db().schedule.get(entry.id)) ?? null }
  }

  // change
  const name = edit.name ?? (edit.content?.kind === 'session' ? edit.content.parsed.header.name : undefined) ?? (sport === (entry.sport ?? 'ride') ? entry.name : SPORT_GROUP_LABEL[sport])
  const thresholds = await sessionThresholds()
  if (fromPlan) {
    const created = await planCopy(entry, fromPlan, edit, name)
    if (await replacePlanWorkout(entry.planId!, fromPlan.id, { id: created.workoutId ?? created.sessionWorkoutId!, ...(created.sessionWorkoutId ? { sport: sport as SessionSport } : {}) })) {
      const after = await planItem(entry.planId!, fromPlan.id)
      await followContent(entry.id)
      return { kind: 'plan', planId: entry.planId!, before: fromPlan, after: after!, created }
    }
    // the plan has gone from the calendar meanwhile: change the entry as a manual one
    await dropCreated(created)
  }
  const created: Created = {}
  let next: ScheduledWorkout
  const c = edit.content
  if (!c) {
    // only the name or notes
    if (isBikeWorkout(entry)) {
      const w = entry.workout ?? (entry.workoutId ? await getWorkout(entry.workoutId) : null)
      if (!w) throw new Error("That workout isn't in the library any more.")
      const copy = await saveBikeCopy(w, name, edit.notes)
      created.workoutId = copy.id
      next = { ...bare(entry), workoutId: copy.id, name }
    } else {
      next = { ...entry, name, ...(edit.notes !== undefined ? { session: { ...entry.session, notes: edit.notes } } : {}) }
    }
  } else if (c.kind === 'bike') {
    const copy = await saveBikeCopy(c.workout, name, edit.notes)
    created.workoutId = copy.id
    next = { ...bare(entry), workoutId: copy.id, name }
  } else if (c.kind === 'plain-ride') {
    next = { ...bare(entry), sport: 'ride', name, session: { durationS: c.durationS, load: effortLoad(c.durationS, c.effort ?? 'moderate'), ...(c.effort ? { effort: c.effort } : {}), ...(edit.notes ? { notes: edit.notes } : {}) } }
  } else {
    next = { ...bare(entry), sport: c.sport, name, session: snapshotOf(sessionWorkoutOf(c, name), thresholds) }
  }
  await db().schedule.put(next)
  await followContent(entry.id)
  return { kind: 'entry', entryId: entry.id, before: entry, after: (await db().schedule.get(entry.id)) ?? next, ...(created.workoutId ? { created } : {}) }
}

/** The new library workout a plan's entry is pointed at. */
async function planCopy(entry: ScheduledWorkout, item: PlanItem, edit: CalendarEdit, name: string): Promise<Created> {
  const c = edit.content
  if (c?.kind === 'session') {
    const w = await saveSessionWorkout(sessionWorkoutOf(c, name))
    return { sessionWorkoutId: w.id }
  }
  if (c?.kind === 'bike') return { workoutId: (await saveBikeCopy(c.workout, name, edit.notes)).id }
  if (c?.kind === 'plain-ride') throw new Error('A ride in a training plan needs steps.')
  // only the name or notes: a copy of the plan's workout with them
  if (item.sport) {
    const old = await getSessionWorkout(item.workoutId)
    if (!old) throw new Error("That session isn't in the library any more.")
    const text = withSessionHeader(old.text, { name, ...(edit.notes !== undefined ? { notes: edit.notes } : {}) })
    const w = await saveSessionWorkout({ ...old, id: newSessionId(), name, text, tags: [...new Set([...old.tags, 'coach'])], source: 'user', ...(edit.notes !== undefined ? { notes: edit.notes } : {}), createdAt: Date.now(), updatedAt: Date.now() })
    return { sessionWorkoutId: w.id }
  }
  const w = await getWorkout(item.workoutId)
  if (!w) throw new Error(`"${entry.name}" isn't in the library any more.`)
  return { workoutId: (await saveBikeCopy(w, name, edit.notes)).id }
}

async function add(r: EditResolve & { ok: true }): Promise<CoachUndo> {
  const { edit } = r
  const c = edit.content
  const date = edit.date!
  const sport: SportGroup = edit.sport ?? 'ride'
  const name = edit.name ?? (c?.kind === 'session' ? c.parsed.header.name : undefined) ?? SPORT_GROUP_LABEL[sport]
  let entry: ScheduledWorkout
  const created: Created = {}
  if (c?.kind === 'bike') {
    const copy = await saveBikeCopy(c.workout, name, edit.notes)
    created.workoutId = copy.id
    entry = await scheduleWorkout(date, { id: copy.id, name })
  } else if (c?.kind === 'plain-ride') {
    entry = await scheduleSession(date, 'ride', name, { durationS: c.durationS, load: effortLoad(c.durationS, c.effort ?? 'moderate'), ...(c.effort ? { effort: c.effort } : {}), ...(edit.notes ? { notes: edit.notes } : {}) })
  } else if (c?.kind === 'session') {
    entry = await scheduleSession(date, c.sport, name, snapshotOf(sessionWorkoutOf(c, name), await sessionThresholds()))
  } else {
    throw new Error('A new session needs steps, or a duration or distance.')
  }
  return { kind: 'entry', entryId: entry.id, before: null, after: entry, ...(created.workoutId ? { created } : {}) }
}

/** Library workouts a change made, taken away when nothing uses them any more. */
async function dropCreated(created: Created | undefined): Promise<void> {
  if (!created) return
  const d = db()
  const [plans, schedule] = await Promise.all([d.plans.toArray(), d.schedule.toArray()])
  const used = (id: string) => plans.some((p) => p.items.some((i) => i.workoutId === id)) || schedule.some((e) => e.workoutId === id || e.session?.sessionWorkoutId === id)
  if (created.workoutId && !used(created.workoutId)) await d.workouts.delete(created.workoutId)
  if (created.sessionWorkoutId && !used(created.sessionWorkoutId)) await d.sessionWorkouts.delete(created.sessionWorkoutId)
}

/** What decides whether an entry is still as a change left it. */
const shape = (e: ScheduledWorkout | null | undefined) => (e ? JSON.stringify([e.date, e.name, e.sport ?? null, e.workoutId, e.session ?? null]) : null)

/** Puts a change back, if the session is still as the change left it. */
export async function undoCoachEdit(undo: CoachUndo): Promise<void> {
  if (undo.kind === 'plan') {
    const now = await planItem(undo.planId, undo.after.id)
    if (!now || JSON.stringify(now) !== JSON.stringify(undo.after)) throw new Error(UNDO_STALE)
    await restorePlanItem(undo.planId, undo.before)
    await dropCreated(undo.created)
    const entryId = `plan-${undo.planId}-${undo.before.id}`
    await followContent(entryId)
    return
  }
  const now = await db().schedule.get(undo.entryId)
  if (shape(now) !== shape(undo.after)) throw new Error(UNDO_STALE)
  if (!undo.before) {
    await removeScheduled(undo.entryId)
  } else if (undo.after && undo.after.date !== undo.before.date && shape({ ...undo.after, date: undo.before.date }) === shape(undo.before)) {
    // a move: back the way it came, so intervals.icu follows
    await moveScheduled(undo.entryId, undo.before.date)
  } else {
    // a removal or a change: the row as it was. An event on intervals.icu removed with it is sent again.
    const pushed = now?.pushedEventId
    const { pushedEventId: _p, ...before } = undo.before
    await db().schedule.put(pushed ? { ...before, pushedEventId: pushed } : undo.after ? undo.before : before)
    if (!undo.after && undo.before.pushedEventId) {
      try {
        await sendToIntervals(undo.entryId)
      } catch {
        // best effort
      }
    } else await followContent(undo.entryId)
  }
  await dropCreated(undo.created)
}

/** A session as the change card shows it. */
export interface EditSide {
  date: string
  name: string
  sport: SportGroup
  durationS: number | null
  distanceM: number | null
  load: number | null
}

async function bikeSide(w: Workout | null, date: string, name: string): Promise<EditSide> {
  if (!w) return { date, name, sport: 'ride', durationS: null, distanceM: null, load: null }
  const ftpW = (await currentFtp())?.ftpW ?? DEFAULT_FTP_W
  const stats = plannedStatsOf(w, describeWorkout(w, ftpW).stats)
  return { date, name, sport: 'ride', durationS: stats.durationS, distanceM: null, load: stats.tss }
}

async function entrySide(e: ScheduledWorkout): Promise<EditSide> {
  if (isBikeWorkout(e)) return bikeSide(e.workout ?? (e.workoutId ? await getWorkout(e.workoutId) : null), e.date, e.name)
  const s = e.session
  return { date: e.date, name: e.name, sport: e.sport ?? 'ride', durationS: s?.durationS ?? null, distanceM: s?.distanceM ?? null, load: s?.load ?? null }
}

/** The session before and after a change, with its time, distance and load worked out as the calendar would. */
export async function previewCoachEdit(r: EditResolve & { ok: true }): Promise<{ before: EditSide | null; after: EditSide | null }> {
  const { edit, entry, sport } = r
  const before = entry ? await entrySide(entry) : null
  if (edit.action === 'remove') return { before, after: null }
  if (edit.action === 'move') return { before, after: before && { ...before, date: edit.date! } }
  const date = edit.date ?? entry!.date
  const c = edit.content
  const name = edit.name ?? (c?.kind === 'session' ? c.parsed.header.name : undefined) ?? (entry && sport === (entry.sport ?? 'ride') ? entry.name : SPORT_GROUP_LABEL[sport])
  if (!c) return { before, after: before && { ...before, name } }
  if (c.kind === 'bike') return { before, after: await bikeSide(c.workout, date, name) }
  if (c.kind === 'plain-ride') return { before, after: { date, name, sport: 'ride', durationS: c.durationS, distanceM: null, load: effortLoad(c.durationS, c.effort ?? 'moderate') } }
  const s = snapshotOf(sessionWorkoutOf(c, name), await sessionThresholds())
  return { before, after: { date, name, sport: c.sport, durationS: s.durationS ?? null, distanceM: s.distanceM ?? null, load: s.load ?? null } }
}
