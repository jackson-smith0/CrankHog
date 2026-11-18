import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entryRef, parseCalendarEdit } from '@core/ai/calendar-edits'
import { sessionFromFile } from '@core/multisport/build'
import { addDays, dateKey } from '@core/workout/schedule'
import type { CrankHogBridge } from '@shared/ipc/contract'
import { updateProfile } from '../db/athlete-repo'
import { db } from '../db/db'
import { saveSessionWorkout } from '../workouts/sessions-repo'
import { applyCoachEdit, resolveNow, undoCoachEdit } from './coach-edits'
import { mirrorSnapshot } from './google-mirror'
import { sendToIntervals } from './intervals-push'
import { addSessionToPlan, addToPlan, createPlan, getPlan, putOnCalendar } from './plans-repo'
import { planSessionWorkout } from '../workouts/sessions-repo'
import { scheduleSession, scheduleWorkout } from './schedule-repo'

const invoke = vi.fn()
const today = dateKey(Date.now())
const nextMonday = (() => {
  let d = addDays(today, 1)
  while (new Date(`${d}T12:00:00`).getDay() !== 1) d = addDays(d, 1)
  return d
})()

const RUN_WALK = 'sport: run\nname: Run-walk 40\n\n8x\n- 4m Z2 HR\n- 1m Z1 HR walk\n'

beforeEach(async () => {
  await db().delete()
  await db().open()
  await updateProfile({ runThresholdPaceSPerKm: 270, lthr: 170 })
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string, req: { eventId?: string }) => {
    if (channel === 'intervals.putWorkout') return { eventId: req.eventId ?? 'ev1' }
    if (channel === 'intervals.deleteWorkout') return { ok: true }
    throw new Error(`unexpected ${channel}`)
  })
  window.crankhog = { invoke, on: () => () => undefined, send: () => undefined } as unknown as CrankHogBridge
})

/** Reads a block, checks it against the calendar, and applies it. */
async function apply(block: string) {
  const p = parseCalendarEdit(block)
  if (!p.ok) throw new Error(p.error)
  const r = await resolveNow(p.edit)
  if (!r.ok) throw new Error(r.problem)
  return applyCoachEdit(r)
}

const runWalk = () => saveSessionWorkout(sessionFromFile('Run-walk 40.txt', RUN_WALK, {}, 1).workout!)

describe('applying a coach change', () => {
  it('turns a manual run-walk into a run, on that day only, and undoes it', async () => {
    const w = await runWalk()
    const day = addDays(today, 2)
    const e = await planSessionWorkout(day, w)
    const undo = await apply(`action: change\nref: ${entryRef(e.id)}\nsport: run\nname: Easy run 40\n\n- 40m Z2 HR`)
    const after = (await db().schedule.get(e.id))!
    expect(after).toMatchObject({ date: day, sport: 'run', name: 'Easy run 40', session: { durationS: 2400, text: '- 40m Z2 HR' } })
    // that day has a copy of its own; the library workout is as it was
    const copy = (await db().sessionWorkouts.get(after.session!.sessionWorkoutId!))!
    expect(copy).toMatchObject({ name: 'Easy run 40', tags: ['coach'] })
    expect((await db().sessionWorkouts.get(w.id))!.text).toBe(RUN_WALK)
    await undoCoachEdit(undo)
    expect(await db().schedule.get(e.id)).toEqual(e)
    expect(await db().sessionWorkouts.get(copy.id)).toBeUndefined()
  })

  it('changes one plan run without touching another day that uses the same workout', async () => {
    const w = await runWalk()
    const plan = await createPlan({ name: 'Base', rideDays: [0, 2], startDate: nextMonday })
    await addSessionToPlan(plan.id, w)
    await addSessionToPlan(plan.id, w)
    await putOnCalendar(plan.id)
    const [first, second] = (await db().schedule.toArray()).sort((a, b) => a.date.localeCompare(b.date))
    const undo = await apply(`action: change\nref: ${entryRef(second!.id)}\nsport: run\nname: Easy run 40\n\n- 40m Z2 HR`)

    const items = (await getPlan(plan.id))!.items
    expect(items[0]!.workoutId).toBe(w.id)
    expect(items[1]!.workoutId).not.toBe(w.id)
    const copy = (await db().sessionWorkouts.get(items[1]!.workoutId))!
    expect(copy).toMatchObject({ name: 'Easy run 40', sport: 'run', tags: ['coach'] })
    // the plan re-laid: the second day reads the copy, the first still the run-walk
    expect((await db().schedule.get(second!.id))!).toMatchObject({ date: second!.date, name: 'Easy run 40', session: { durationS: 2400 } })
    expect((await db().schedule.get(first!.id))!.name).toBe('Run-walk 40')

    await undoCoachEdit(undo)
    expect((await getPlan(plan.id))!.items[1]!.workoutId).toBe(w.id)
    expect((await db().schedule.get(second!.id))!.name).toBe('Run-walk 40')
    expect(await db().sessionWorkouts.get(copy.id)).toBeUndefined()
  })

  it('changes a ride into a library copy tagged coach', async () => {
    const e = await scheduleWorkout(addDays(today, 1), { id: 'builtin:sweet-spot-3x12', name: 'Sweet Spot 3×12' })
    const undo = await apply(`action: change\nref: ${entryRef(e.id)}\nsport: ride\nname: Sweet spot 2x12\n\n- 10m ramp 50-75%\n2x\n- 12m 90%\n- 4m 55%\n- 5m 50%`)
    const after = (await db().schedule.get(e.id))!
    expect(after.name).toBe('Sweet spot 2x12')
    const copy = (await db().workouts.get(after.workoutId!))!
    expect(copy).toMatchObject({ name: 'Sweet spot 2x12', source: 'ai' })
    expect(copy.tags).toContain('coach')
    await undoCoachEdit(undo)
    expect((await db().schedule.get(e.id))!.workoutId).toBe('builtin:sweet-spot-3x12')
    expect(await db().workouts.get(copy.id)).toBeUndefined()
  })

  it('shortens a session without steps', async () => {
    const e = await scheduleSession(addDays(today, 1), 'other', 'Squash', { durationS: 3600, effort: 'hard', load: 80 })
    await apply(`action: change\nref: ${entryRef(e.id)}\nsport: other\nname: Squash\nduration: 30m\neffort: moderate`)
    expect((await db().schedule.get(e.id))!.session).toMatchObject({ durationS: 1800, effort: 'moderate', load: 30 })
  })

  it('moves a plan workout through the plan, and undoes the move', async () => {
    const plan = await createPlan({ name: 'Base', rideDays: [0], startDate: nextMonday })
    await addToPlan(plan.id, 'builtin:sweet-spot-3x12')
    await putOnCalendar(plan.id)
    const [e] = await db().schedule.toArray()
    const to = addDays(nextMonday, 2)
    const undo = await apply(`action: move\nref: ${entryRef(e!.id)}\ndate: ${to}`)
    expect((await getPlan(plan.id))!.items[0]!.movedTo).toBe(to)
    expect((await db().schedule.get(e!.id))!.date).toBe(to)
    await undoCoachEdit(undo)
    expect((await getPlan(plan.id))!.items[0]!.movedTo).toBeUndefined()
    expect((await db().schedule.get(e!.id))!.date).toBe(nextMonday)
  })

  it('removes a plan workout, keeping it in the plan, and undoes the removal', async () => {
    const plan = await createPlan({ name: 'Base', rideDays: [0], startDate: nextMonday })
    await addToPlan(plan.id, 'builtin:sweet-spot-3x12')
    await putOnCalendar(plan.id)
    const [e] = await db().schedule.toArray()
    const undo = await apply(`action: remove\nref: ${entryRef(e!.id)}`)
    expect((await getPlan(plan.id))!.items[0]!.removed).toBe(true)
    expect(await db().schedule.count()).toBe(0)
    await undoCoachEdit(undo)
    expect(await db().schedule.count()).toBe(1)
  })

  it('moves and removes a manual entry, and undoes both', async () => {
    const e = await scheduleSession(addDays(today, 1), 'run', 'Run', { durationS: 1800 })
    const moved = await apply(`action: move\nref: ${entryRef(e.id)}\ndate: ${addDays(today, 3)}`)
    expect((await db().schedule.get(e.id))!.date).toBe(addDays(today, 3))
    await undoCoachEdit(moved)
    expect((await db().schedule.get(e.id))!.date).toBe(addDays(today, 1))
    const removed = await apply(`action: remove\nref: ${entryRef(e.id)}`)
    expect(await db().schedule.get(e.id)).toBeUndefined()
    await undoCoachEdit(removed)
    expect(await db().schedule.get(e.id)).toEqual(e)
  })

  it('adds a run, a ride and a spin, and undoes an addition', async () => {
    const day = addDays(today, 4)
    const run = await apply(`action: add\ndate: ${day}\nsport: run\nname: Shakeout\n\n- 20m Z1 HR`)
    await apply(`action: add\ndate: ${day}\nsport: ride\nname: Openers\n\n- 10m 60%\n3x\n- 1m 110%\n- 2m 50%`)
    await apply(`action: add\ndate: ${day}\nsport: ride\nname: Spin\nduration: 30m\neffort: easy`)
    const list = await db().schedule.toArray()
    expect(list.map((e) => [e.name, e.sport ?? 'ride'])).toEqual(expect.arrayContaining([['Shakeout', 'run'], ['Openers', 'ride'], ['Spin', 'ride']]))
    expect(list.find((e) => e.name === 'Spin')!.session).toMatchObject({ durationS: 1800, load: 20 })
    await undoCoachEdit(run)
    expect((await db().schedule.toArray()).map((e) => e.name)).not.toContain('Shakeout')
  })

  it('sends a changed run to intervals.icu again when it was sent before', async () => {
    const e = await scheduleSession(addDays(today, 2), 'run', 'Run-walk', { text: '- 4m Z2 HR\n- 1m Z1 HR', durationS: 300 })
    await sendToIntervals(e.id)
    invoke.mockClear()
    await apply(`action: change\nref: ${entryRef(e.id)}\nsport: run\nname: Run\n\n- 40m Z2 HR`)
    expect(invoke).toHaveBeenCalledWith('intervals.putWorkout', expect.objectContaining({ eventId: 'ev1', workout: expect.objectContaining({ name: 'Run', description: '- 40m Z2 HR' }) }))
  })

  it('refuses an undo once the session has changed again', async () => {
    const e = await scheduleSession(addDays(today, 1), 'run', 'Run', { durationS: 1800 })
    const undo = await apply(`action: change\nref: ${entryRef(e.id)}\nname: Long run`)
    await db().schedule.update(e.id, { name: 'Something else' })
    await expect(undoCoachEdit(undo)).rejects.toThrow(/changed since/)
  })

  it('checks the calendar again when Apply is pressed', async () => {
    const e = await scheduleSession(addDays(today, 1), 'run', 'Run', { durationS: 1800 })
    const p = parseCalendarEdit(`action: remove\nref: ${entryRef(e.id)}`)
    if (!p.ok) throw new Error(p.error)
    const r = await resolveNow(p.edit)
    await db().schedule.delete(e.id)
    await expect(applyCoachEdit(r)).rejects.toThrow(/isn't on the calendar/)
  })

  describe('the Google Calendar mirror', () => {
    const event = async (id: string) => (await mirrorSnapshot(Date.now(), 'metric')).events.find((e) => e.key === id)

    it('shows a changed manual run with its new name and whole file, and the old one again after Undo', async () => {
      const e = await planSessionWorkout(addDays(today, 2), await runWalk())
      expect((await event(e.id))!.description).toContain('1m Z1 HR walk')
      const undo = await apply(`action: change\nref: ${entryRef(e.id)}\nsport: run\nname: Easy run 40\nnotes: Conversational the whole way.\n\n- 40m Z2 HR`)
      const ev = (await event(e.id))!
      expect(ev.title).toContain('Easy run 40')
      expect(ev.description).toContain('sport: run\nname: Easy run 40\nnotes: Conversational the whole way.\n\n- 40m Z2 HR')
      expect(ev.description).not.toContain('walk')
      await undoCoachEdit(undo)
      expect((await event(e.id))!.description).toContain('1m Z1 HR walk')
    })

    it('shows a changed plan run, and leaves the plan\'s other day as it was', async () => {
      const w = await runWalk()
      const plan = await createPlan({ name: 'Base', rideDays: [0, 2], startDate: nextMonday })
      await addSessionToPlan(plan.id, w)
      await addSessionToPlan(plan.id, w)
      await putOnCalendar(plan.id)
      const [first, second] = (await db().schedule.toArray()).sort((a, b) => a.date.localeCompare(b.date))
      await apply(`action: change\nref: ${entryRef(second!.id)}\nsport: run\nname: Easy run 40\n\n- 40m Z2 HR`)
      expect((await event(second!.id))!.description).toContain('- 40m Z2 HR')
      expect((await event(first!.id))!.description).toContain('1m Z1 HR walk')
    })

    it('shows a changed ride with its new time, a moved session on its new day, and drops a removed one', async () => {
      const ride = await scheduleWorkout(addDays(today, 1), { id: 'builtin:sweet-spot-3x12', name: 'Sweet Spot 3×12' })
      await apply(`action: change\nref: ${entryRef(ride.id)}\nsport: ride\nname: Short spin\nnotes: Legs only.\n\n- 30m 55%`)
      const ev = (await event(ride.id))!
      expect(ev.title).toContain('Short spin')
      expect(ev.description).toContain('30 min')
      expect(ev.description).toContain('- 30m 55%')
      expect(ev.description).not.toContain('12m')
      expect(ev.description).toContain('Legs only.')

      const run = await scheduleSession(addDays(today, 1), 'run', 'Run', { durationS: 1800 })
      await apply(`action: move\nref: ${entryRef(run.id)}\ndate: ${addDays(today, 5)}`)
      expect((await event(run.id))!.date).toBe(addDays(today, 5))
      await apply(`action: remove\nref: ${entryRef(run.id)}`)
      expect(await event(run.id)).toBeUndefined()
    })
  })
})
