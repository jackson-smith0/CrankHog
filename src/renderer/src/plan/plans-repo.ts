// Named training plans in IndexedDB, and how they reach the calendar. A plan
// on the calendar is re-laid whenever it changes: its workouts not yet ridden
// are taken off and put back where layOutPlan says, while the ones already
// ridden stay where they were.
import { isBlocking, layOutPlan, parseDatedFileName, type PlanItem, type TrainingPlan } from '@core/workout/plan'
import { completions, dateKey, type DateKey, type ScheduledWorkout } from '@core/workout/schedule'
import type { Workout } from '@core/workout/model'
import { currentFtp, DEFAULT_FTP_W } from '../db/athlete-repo'
import { db } from '../db/db'
import { BUILTINS, parseWorkoutFile, saveWorkout } from '../workouts/library'

const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`
const LEGACY_MIGRATED = 'plans.legacyFolderMigrated'

/** The next Monday after today (or today, on a Monday): where a new plan starts. */
export function nextMonday(now = Date.now()): DateKey {
  const d = new Date(now)
  const ahead = (8 - d.getDay()) % 7
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + ahead).getTime())
}

export async function listPlans(): Promise<TrainingPlan[]> {
  return (await db().plans.toArray()).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getPlan(id: string): Promise<TrainingPlan | undefined> {
  return db().plans.get(id)
}

export async function createPlan(init: Partial<Omit<TrainingPlan, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }): Promise<TrainingPlan> {
  const now = Date.now()
  const plan: TrainingPlan = {
    items: [],
    rideDays: [1, 3, 5],
    startDate: nextMonday(now),
    onCalendar: false,
    source: 'manual',
    ...init,
    id: newId('p'),
    name: init.name.trim() || 'Training plan',
    createdAt: now,
    updatedAt: now,
  }
  await db().plans.put(plan)
  return plan
}

/** Saves changes to a plan, and re-lays it if it is on the calendar. */
export async function updatePlan(id: string, patch: Partial<Omit<TrainingPlan, 'id' | 'createdAt'>>): Promise<TrainingPlan> {
  const plan = await db().plans.get(id)
  if (!plan) throw new Error('That plan no longer exists.')
  const next: TrainingPlan = { ...plan, ...patch, updatedAt: Date.now() }
  await db().plans.put(next)
  if (next.onCalendar) await relay(next)
  return next
}

export async function deletePlan(id: string): Promise<void> {
  const plan = await db().plans.get(id)
  if (!plan) return
  await relay({ ...plan, onCalendar: false })
  await db().plans.delete(id)
}

export async function putOnCalendar(id: string): Promise<TrainingPlan> {
  return updatePlan(id, { onCalendar: true })
}

/** Takes the plan's workouts not yet ridden off the calendar. Ridden ones stay, as history. */
export async function takeOffCalendar(id: string): Promise<TrainingPlan> {
  const plan = await updatePlan(id, { onCalendar: false })
  await relay(plan)
  return plan
}

export async function addToPlan(id: string, workoutId: string, date?: DateKey): Promise<TrainingPlan> {
  const plan = await db().plans.get(id)
  if (!plan) throw new Error('That plan no longer exists.')
  const item: PlanItem = { id: newId('i'), workoutId, ...(date ? { date } : {}) }
  return updatePlan(id, { items: [...plan.items, item] })
}

export async function removeItem(id: string, itemId: string): Promise<TrainingPlan> {
  const plan = await db().plans.get(id)
  if (!plan) throw new Error('That plan no longer exists.')
  return updatePlan(id, { items: plan.items.filter((i) => i.id !== itemId) })
}

/** Moves an item one place earlier (-1) or later (1). */
export async function moveItem(id: string, itemId: string, by: -1 | 1): Promise<TrainingPlan> {
  const plan = await db().plans.get(id)
  if (!plan) throw new Error('That plan no longer exists.')
  const items = plan.items.slice()
  const at = items.findIndex((i) => i.id === itemId)
  const to = at + by
  if (at < 0 || to < 0 || to >= items.length) return plan
  ;[items[at], items[to]] = [items[to]!, items[at]!]
  return updatePlan(id, { items })
}

/** Names for the calendar: built-ins and the rider's own workouts. */
async function workoutNames(ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const w of BUILTINS) if (ids.includes(w.id)) names.set(w.id, w.name)
  for (const row of await db().workouts.bulkGet(ids.filter((id) => !names.has(id)))) if (row) names.set(row.id, row.name)
  return names
}

/** Brings the calendar in line with the plan (see the top of this file). */
async function relay(plan: TrainingPlan): Promise<void> {
  const d = db()
  await d.transaction('rw', [d.schedule, d.rides, d.dayMarks, d.workouts], async () => {
    const mine = (await d.schedule.toArray()).filter((e) => e.planId === plan.id)
    const workoutIds = [...new Set(mine.map((e) => e.workoutId).filter((x): x is string => !!x))]
    const rides = workoutIds.length > 0 ? await d.rides.where('workoutId').anyOf(workoutIds).toArray() : []
    const done = completions(mine, rides.map((r) => ({ id: r.id, startedAt: r.startedAt, workoutId: r.workoutId, simulated: r.simulated })))
    const doneItems = new Set(mine.filter((e) => done.has(e.id)).map((e) => e.planItemId))
    await d.schedule.bulkDelete(mine.filter((e) => !done.has(e.id)).map((e) => e.id))
    if (!plan.onCalendar) return

    const marks = await d.dayMarks.toArray()
    const event = plan.eventId ? marks.find((m) => m.id === plan.eventId) : undefined
    const layout = layOutPlan({
      items: plan.items,
      rideDays: plan.rideDays,
      startDate: plan.startDate,
      today: dateKey(Date.now()),
      blocked: new Set(marks.filter(isBlocking).map((m) => m.date)),
      endDate: event?.date,
    })
    const names = await workoutNames(plan.items.map((i) => i.workoutId))
    const entries: ScheduledWorkout[] = layout.placements
      .map((p) => ({ p, item: plan.items[p.index]! }))
      .filter(({ item }) => !doneItems.has(item.id))
      .map(({ p, item }) => ({
        id: `plan-${plan.id}-${item.id}`,
        date: p.date,
        workoutId: item.workoutId,
        workout: null,
        name: names.get(item.workoutId) ?? 'Workout',
        source: 'manual',
        planId: plan.id,
        planItemId: item.id,
        // the plan's order, so a day's workouts list in it
        createdAt: plan.createdAt + p.index,
      }))
    await d.schedule.bulkPut(entries)
  })
}

/** Re-lays every plan on the calendar (after an event or a day off changes). */
export async function relayAllPlans(): Promise<void> {
  for (const plan of await db().plans.toArray()) if (plan.onCalendar) await relay(plan)
}

export interface PlanImportResult {
  added: number
  failed: { name: string; reason: string }[]
}

/**
 * Workout files into a plan, in file-name order ("01 …", "02 …"). A name
 * starting "YYYY-MM-DD_" puts the workout on that day; the prefix is dropped
 * from the name, and a .zwo keeps the name written inside it.
 */
export async function importIntoPlan(id: string, files: readonly { name: string; text: string }[]): Promise<PlanImportResult> {
  const plan = await db().plans.get(id)
  if (!plan) throw new Error('That plan no longer exists.')
  const ftpW = (await currentFtp())?.ftpW ?? DEFAULT_FTP_W
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const items: PlanItem[] = []
  const failed: PlanImportResult['failed'] = []
  for (const f of ordered) {
    try {
      const { date, rest } = parseDatedFileName(f.name)
      const ext = /\.[^.]+$/.exec(f.name)?.[0] ?? ''
      const { workout } = parseWorkoutFile(`${rest}${ext}`, f.text)
      const saved = await saveWorkout({ ...workout, folder: 'plan', planId: id }, ftpW)
      items.push({ id: newId('i'), workoutId: saved.id, ...(date ? { date } : {}) })
    } catch (e) {
      failed.push({ name: f.name, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  if (items.length > 0) await updatePlan(id, { items: [...plan.items, ...items], source: plan.items.length === 0 ? 'files' : plan.source })
  return { added: items.length, failed }
}

/**
 * Before named plans there was one Training plan folder. The first time,
 * its workouts become a plan called "Training plan", in their old order. The
 * workouts keep their folder, so nothing moves in the library.
 */
export async function migrateLegacyPlanFolder(): Promise<void> {
  const d = db()
  if (await d.kv.get(LEGACY_MIGRATED)) return
  const filed = (await d.workouts.toArray()).filter((w) => w.json.folder === 'plan').sort((a, b) => (a.planOrder ?? 0) - (b.planOrder ?? 0))
  if (filed.length > 0 && (await d.plans.count()) === 0) {
    const plan = await createPlan({ name: 'Training plan', items: filed.map((w) => ({ id: newId('i'), workoutId: w.id })) })
    await Promise.all(filed.map((w) => d.workouts.put({ ...w, json: { ...w.json, planId: plan.id } })))
  }
  await d.kv.put({ key: LEGACY_MIGRATED, value: true })
}

/**
 * After the builder saves a workout filed in a plan: makes sure that plan
 * has it, creating a plan called "Training plan" when none was picked (or
 * the one picked has gone).
 */
export async function fileWorkoutInPlan(w: Workout, ftpW: number): Promise<Workout> {
  if (w.folder !== 'plan') return w
  let plan = w.planId ? await db().plans.get(w.planId) : undefined
  plan ??= await createPlan({ name: 'Training plan' })
  let workout = w
  if (w.planId !== plan.id) workout = await saveWorkout({ ...w, planId: plan.id }, ftpW)
  if (!plan.items.some((i) => i.workoutId === workout.id)) await addToPlan(plan.id, workout.id)
  return workout
}

/**
 * Takes an item out of a plan. A workout of the rider's own that was filed
 * in this plan, and is in no other, goes back to Custom workouts.
 */
export async function takeOutOfPlan(id: string, itemId: string): Promise<void> {
  const plan = await db().plans.get(id)
  const item = plan?.items.find((i) => i.id === itemId)
  if (!plan || !item) return
  await removeItem(id, itemId)
  const row = await db().workouts.get(item.workoutId)
  const elsewhere = (await db().plans.toArray()).some((p) => p.id !== id && p.items.some((i) => i.workoutId === item.workoutId))
  if (row && row.json.folder === 'plan' && !elsewhere) {
    const { planId: _gone, folder: _f, ...json } = row.json
    await db().workouts.put({ ...row, json, planOrder: undefined, updatedAt: Date.now() })
  }
}
