import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { SESSION_EXAMPLES } from '@core/multisport/examples'
import { sessionFromFile } from '@core/multisport/build'
import { addDays, dateKey } from '@core/workout/schedule'
import { updateProfile } from '../db/athlete-repo'
import { db } from '../db/db'
import { saveSessionWorkout } from '../workouts/sessions-repo'
import { addManualActivity } from './activities-repo'
import { addSessionToPlan, addToPlan, createPlan, getPlan, importIntoPlan, putOnCalendar, updatePlan } from './plans-repo'
import { moveScheduled, removeScheduled } from './schedule-repo'

const today = dateKey(Date.now())
const nextMonday = (() => {
  let d = addDays(today, 1)
  while (new Date(`${d}T12:00:00`).getDay() !== 1) d = addDays(d, 1)
  return d
})()
const entries = () => db().schedule.toArray().then((l) => l.sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.sport ?? 'ride', e.name]))

const easy8k = async () => saveSessionWorkout(sessionFromFile(SESSION_EXAMPLES[3]!.fileName, SESSION_EXAMPLES[3]!.text, {}, 1).workout!)

beforeEach(async () => {
  await db().delete()
  await db().open()
  await updateProfile({ runThresholdPaceSPerKm: 255 })
})

describe('runs and swims in a plan', () => {
  it('lays a run out on the plan’s days like a ride, with what it adds up to', async () => {
    const run = await easy8k()
    const plan = await createPlan({ name: 'Base', rideDays: [0, 2], startDate: nextMonday })
    await addToPlan(plan.id, 'builtin:sweet-spot-3x12')
    await addSessionToPlan(plan.id, run)
    await putOnCalendar(plan.id)
    expect(await entries()).toEqual([
      [nextMonday, 'ride', 'Sweet Spot 3×12'],
      [addDays(nextMonday, 2), 'run', 'Easy 8k'],
    ])
    const [, e] = (await db().schedule.toArray()).sort((a, b) => a.date.localeCompare(b.date))
    expect(e).toMatchObject({ workoutId: null, workout: null, session: { sessionWorkoutId: run.id, durationS: 2720, distanceM: 8000, effort: 'easy' } })
  })

  it('keeps a run you did where it was when the plan is re-laid', async () => {
    const run = await easy8k()
    // a plan that started last week, so its first day has been
    const start = addDays(today, -1)
    const plan = await createPlan({ name: 'Base', rideDays: [0, 1, 2, 3, 4, 5, 6], startDate: start })
    await addSessionToPlan(plan.id, run)
    await addToPlan(plan.id, 'builtin:sweet-spot-3x12')
    await putOnCalendar(plan.id)
    await addManualActivity({ date: start, group: 'run', durationS: 2700 })
    // reorder: the ride goes first, but the run already done stays on its day
    const p = (await getPlan(plan.id))!
    await updatePlan(plan.id, { items: [p.items[1]!, p.items[0]!] })
    const list = (await db().schedule.toArray()).map((e) => [e.date, e.sport ?? 'ride'])
    expect(list).toContainEqual([start, 'run'])
    expect(list.filter(([, s]) => s === 'run')).toHaveLength(1)
  })

  it('moves and removes a planned run on the calendar, and the plan keeps the change', async () => {
    const run = await easy8k()
    const plan = await createPlan({ name: 'Base', rideDays: [0], startDate: nextMonday })
    await addSessionToPlan(plan.id, run)
    await putOnCalendar(plan.id)
    const [e] = await db().schedule.toArray()
    await moveScheduled(e!.id, addDays(nextMonday, 3))
    expect((await getPlan(plan.id))!.items[0]!.movedTo).toBe(addDays(nextMonday, 3))
    expect(await entries()).toEqual([[addDays(nextMonday, 3), 'run', 'Easy 8k']])
    await removeScheduled(e!.id)
    expect((await getPlan(plan.id))!.items[0]!.removed).toBe(true)
    expect(await db().schedule.count()).toBe(0)
  })

  it('imports session files into a plan, dated ones on their day, with a report line each', async () => {
    const plan = await createPlan({ name: 'Build', rideDays: [0, 2, 4], startDate: nextMonday })
    const r = await importIntoPlan(plan.id, [...SESSION_EXAMPLES.map((e) => ({ name: e.fileName, text: e.text })), { name: 'Bad.txt', text: 'sport: run\n\n- 10m Z2 HR 4:00/km Pace' }])
    expect(r.added).toBe(4)
    expect(r.lines.map((l) => [l.file, l.outcome])).toEqual([
      ['2026-12-02_Threshold 4x8.txt', 'plan'],
      ['2026-12-03_CSS 10x100.txt', 'plan'],
      ['2026-12-04_Squash.txt', 'plan'],
      ['Bad.txt', 'skipped'],
      ['Easy 8k.txt', 'plan'],
    ])
    expect(r.failed).toEqual([{ name: 'Bad.txt', reason: 'line 3: one target per step. "Z2 HR 4:00/km Pace" has two.' }])
    const items = (await getPlan(plan.id))!.items
    expect(items.map((i) => [i.sport, i.date ?? null])).toEqual([
      ['run', '2026-12-02'],
      ['swim', '2026-12-03'],
      ['other', '2026-12-04'],
      ['run', null],
    ])
    expect(await db().sessionWorkouts.count()).toBe(4)
  })
})
