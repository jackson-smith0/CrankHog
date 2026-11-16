import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionFromFile } from '@core/multisport/build'
import { SESSION_EXAMPLES } from '@core/multisport/examples'
import { addDays, dateKey } from '@core/workout/schedule'
import type { CrankHogBridge } from '@shared/ipc/contract'
import { db } from '../db/db'
import { saveSessionWorkout } from '../workouts/sessions-repo'
import { sendToIntervals } from './intervals-push'
import { addSessionToPlan, createPlan, putOnCalendar } from './plans-repo'
import { moveScheduled, removeScheduled, scheduleSession, scheduleWorkout } from './schedule-repo'

const invoke = vi.fn()
let nextEvent = 100

beforeEach(async () => {
  await db().delete()
  await db().open()
  invoke.mockReset()
  nextEvent = 100
  invoke.mockImplementation(async (channel: string, req: { eventId?: string }) => {
    if (channel === 'intervals.putWorkout') return { eventId: req.eventId ?? String(nextEvent++) }
    if (channel === 'intervals.deleteWorkout') return { ok: true }
    if (channel === 'intervals.status') return { configured: true }
    throw new Error(`unexpected ${channel}`)
  })
  window.crankhog = { invoke, on: () => () => undefined, send: () => undefined } as unknown as CrankHogBridge
})

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('sending a planned session to intervals.icu', () => {
  it('sends the steps without the header, under CrankHog’s external id, and remembers the event', async () => {
    const e = await scheduleSession('2026-12-02', 'run', 'Threshold 4x8', { text: 'Warmup\n- 15m Z2 HR', durationS: 3900, load: 91.5 })
    expect(await sendToIntervals(e.id)).toBe('100')
    expect(invoke).toHaveBeenCalledWith('intervals.putWorkout', {
      workout: { date: '2026-12-02', type: 'Run', name: 'Threshold 4x8', description: 'Warmup\n- 15m Z2 HR', externalId: `freegaz-plan-${e.id}`, movingTimeS: 3900, load: 91.5 },
    })
    expect((await db().schedule.get(e.id))!.pushedEventId).toBe('100')
  })

  it('follows a move and a removal there', async () => {
    const e = await scheduleSession('2026-12-02', 'swim', 'Swim', { text: '- 400mtr easy' })
    await sendToIntervals(e.id)
    invoke.mockClear()
    await moveScheduled(e.id, '2026-12-05')
    await settle()
    expect(invoke).toHaveBeenCalledWith('intervals.putWorkout', expect.objectContaining({ eventId: '100', workout: expect.objectContaining({ date: '2026-12-05', type: 'Swim' }) }))
    invoke.mockClear()
    await removeScheduled(e.id)
    await settle()
    expect(invoke).toHaveBeenCalledWith('intervals.deleteWorkout', { eventId: '100' })
  })

  it('leaves intervals.icu alone for a session never sent', async () => {
    const e = await scheduleSession('2026-12-02', 'run', 'Run', { durationS: 1800 })
    await moveScheduled(e.id, '2026-12-03')
    await removeScheduled(e.id)
    await settle()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps a plan’s sent run there through a re-lay, and moves it there when it moves here', async () => {
    const run = await saveSessionWorkout(sessionFromFile(SESSION_EXAMPLES[3]!.fileName, SESSION_EXAMPLES[3]!.text, {}, 1).workout!)
    const start = addDays(dateKey(Date.now()), 7)
    const plan = await createPlan({ name: 'Base', rideDays: [0, 1, 2, 3, 4, 5, 6], startDate: start })
    await addSessionToPlan(plan.id, run)
    await putOnCalendar(plan.id)
    const [e] = await db().schedule.toArray()
    await sendToIntervals(e!.id)
    invoke.mockClear()
    await moveScheduled(e!.id, addDays(start, 2))
    await settle()
    const [moved] = await db().schedule.toArray()
    expect(moved).toMatchObject({ id: e!.id, date: addDays(start, 2), pushedEventId: '100' })
    expect(invoke).toHaveBeenCalledWith('intervals.putWorkout', expect.objectContaining({ eventId: '100', workout: expect.objectContaining({ date: addDays(start, 2) }) }))
  })

  it('refuses a bike workout: those are ridden here', async () => {
    const e = await scheduleWorkout('2026-12-02', { id: 'builtin:sweet-spot-3x12', name: 'Sweet spot' })
    await expect(sendToIntervals(e.id)).rejects.toThrow(/Bike workouts are ridden here/)
  })
})
