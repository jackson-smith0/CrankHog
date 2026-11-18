import { describe, expect, it } from 'vitest'
import type { ScheduledWorkout } from '../workout/schedule'
import { editCount, entryRef, isRealDay, parseCalendarEdit, resolveEdit, splitCoachReply, withSessionHeader, type CalendarEdit } from './calendar-edits'

const TODAY = '2026-11-18'

const entry = (id: string, date: string, extra: Partial<ScheduledWorkout> = {}): ScheduledWorkout => ({ id, date, workoutId: null, workout: null, name: `Session ${id}`, source: 'manual', sport: 'run', session: { durationS: 2400, text: '- 4m Z2 HR\n- 1m rest' }, createdAt: 0, ...extra })

const parsed = (block: string): CalendarEdit => {
  const r = parseCalendarEdit(block)
  if (!r.ok) throw new Error(r.error)
  return r.edit
}

const problem = (block: string): string => {
  const r = parseCalendarEdit(block)
  if (r.ok) throw new Error('expected an error')
  return r.error
}

describe('entryRef', () => {
  it('is six base-36 characters, the same for the same id', () => {
    const ref = entryRef('plan-p1-item7')
    expect(ref).toMatch(/^[0-9a-z]{6}$/)
    expect(entryRef('plan-p1-item7')).toBe(ref)
    expect(entryRef('plan-p1-item8')).not.toBe(ref)
  })
})

describe('isRealDay', () => {
  it('takes real days only', () => {
    expect(isRealDay('2026-11-19')).toBe(true)
    expect(isRealDay('2026-02-30')).toBe(false)
    expect(isRealDay('19/11/2026')).toBe(false)
  })
})

describe('splitCoachReply', () => {
  const reply = [
    'Fair enough, run the lot.',
    '',
    '```crankhog',
    'action: change',
    'ref: abc123',
    'sport: run',
    'name: Easy run 40',
    '',
    '- 40m Z2 HR',
    '```',
    '',
    'And Saturday goes to Sunday:',
    '```crankhog',
    'action: move',
    'ref: def456',
    'date: 2026-11-22',
    '```',
  ].join('\n')

  it('cuts a reply into text and numbered changes', () => {
    const parts = splitCoachReply(reply)
    expect(parts.map((p) => p.kind)).toEqual(['text', 'edit', 'text', 'edit'])
    expect(parts[1]).toMatchObject({ kind: 'edit', index: 0, parse: { ok: true, edit: { action: 'change', ref: 'abc123' } } })
    expect(parts[3]).toMatchObject({ kind: 'edit', index: 1, parse: { ok: true, edit: { action: 'move', date: '2026-11-22' } } })
    expect(editCount(reply)).toBe(2)
  })

  it('shows a block still being written as pending', () => {
    const parts = splitCoachReply('Here it is:\n```crankhog\naction: change\nref: abc')
    expect(parts.map((p) => p.kind)).toEqual(['text', 'pending'])
  })

  it('leaves other code blocks in the text', () => {
    const parts = splitCoachReply('Paste this:\n```\n- 10m 60%\n```')
    expect(parts).toEqual([{ kind: 'text', text: 'Paste this:\n```\n- 10m 60%\n```' }])
  })
})

describe('parseCalendarEdit', () => {
  it('reads a change of a run into session steps', () => {
    const e = parsed('action: change\nref: ABC123\nsport: run\nname: Easy run 40\nwhy: You asked to run it all.\n\nRun\n- 40m Z2 HR')
    expect(e).toMatchObject({ action: 'change', ref: 'abc123', sport: 'run', name: 'Easy run 40', why: 'You asked to run it all.' })
    expect(e.content?.kind).toBe('session')
    if (e.content?.kind !== 'session') return
    expect(e.content.parsed.sections[0]!.steps[0]).toMatchObject({ durationS: 2400, target: { kind: 'hrZone' } })
    expect(e.content.file).toContain('sport: run\nname: Easy run 40')
  })

  it('reads steps written without a blank line after the header', () => {
    const e = parsed('action: add\ndate: 2026-11-20\nsport: swim\nname: Easy swim\n- 400mtr easy')
    expect(e.content?.kind).toBe('session')
  })

  it('reads a ride as intervals.icu bike text', () => {
    const e = parsed('action: change\nref: abc123\nsport: ride\nname: Shorter threshold\n\n- 10m ramp 50-75%\n3x\n- 8m 95%\n- 4m 55%\n- 5m 50%')
    expect(e.content?.kind).toBe('bike')
    if (e.content?.kind !== 'bike') return
    expect(e.content.workout.name).toBe('Shorter threshold')
    expect(e.content.workout.tags).toEqual(['coach'])
  })

  it('reads a ride without steps from its duration and effort', () => {
    expect(parsed('action: add\ndate: 2026-11-20\nsport: ride\nname: Spin\nduration: 45m\neffort: easy').content).toEqual({ kind: 'plain-ride', durationS: 2700, effort: 'easy' })
  })

  it('reads a session without steps', () => {
    const e = parsed('action: change\nref: abc123\nsport: other\nname: Squash\nduration: 45m\neffort: hard')
    expect(e.content?.kind).toBe('session')
  })

  it('keeps a change of only the name without content', () => {
    const e = parsed('action: change\nref: abc123\nname: Long run')
    expect(e.content).toBeUndefined()
  })

  it('reads moves and removals', () => {
    expect(parsed('action: move\nref: abc123\ndate: 2026-11-21')).toMatchObject({ action: 'move', date: '2026-11-21' })
    expect(parsed('action: remove\nref: abc123')).toMatchObject({ action: 'remove' })
  })

  it('says what is wrong', () => {
    expect(problem('ref: abc123')).toMatch(/no action/)
    expect(problem('action: move\ndate: 2026-11-21')).toMatch(/ref/)
    expect(problem('action: move\nref: abc123')).toMatch(/needs a date/)
    expect(problem('action: move\nref: abc123\ndate: 2026-02-30')).toMatch(/isn't a day/)
    expect(problem('action: add\ndate: 2026-11-21\nsport: rowing')).toMatch(/isn't a sport/)
    expect(problem('action: add\ndate: 2026-11-21\nname: Run')).toMatch(/needs a sport/)
    expect(problem('action: add\ndate: 2026-11-21\nsport: run')).toMatch(/needs steps/)
    expect(problem('action: change\nref: abc123\n\n- 40m Z2 HR')).toMatch(/needs the sport/)
    expect(problem('action: add\ndate: 2026-11-21\nsport: ride')).toMatch(/steps/)
  })

  it('passes on the session parser\'s errors, with the line counted from the steps', () => {
    expect(problem('action: change\nref: abc123\nsport: run\n\n- 10m Z2 HR\n- 8m Z2 HR 4:30/km Pace')).toMatch(/^Step line 2: one target per step/)
  })

  it('passes on bike text errors', () => {
    expect(problem('action: change\nref: abc123\nsport: ride\n\n- 10m banana')).toMatch(/^Step line 1/)
  })

  it('keeps the session parser\'s warnings', () => {
    expect(parsed('action: change\nref: abc123\nsport: swim\n\n- 400m easy').warnings.join(' ')).toMatch(/400 minutes/)
  })

  it('refuses a change that tells the rider to hurt themselves', () => {
    expect(problem('action: change\nref: abc123\nname: Go kill yourself')).toMatch(/hurt or kill/)
  })
})

describe('resolveEdit', () => {
  const run = entry('run1', '2026-11-19')
  const schedule = [run, entry('done1', '2026-11-17'), entry('icu1', '2026-11-20', { source: 'intervals' }), entry('old1', '2026-11-16')]
  const done = new Set(['done1'])
  const resolve = (block: string) => resolveEdit(parsed(block), schedule, done, TODAY)

  it('finds the entry a ref names', () => {
    const r = resolve(`action: change\nref: ${entryRef('run1')}\nsport: run\n\n- 40m Z2 HR`)
    expect(r).toMatchObject({ ok: true, entry: { id: 'run1' }, sport: 'run' })
  })

  it('keeps the entry\'s sport when the change doesn\'t name one', () => {
    expect(resolve(`action: change\nref: ${entryRef('run1')}\nname: Long run`)).toMatchObject({ ok: true, sport: 'run' })
  })

  it('says when the ref names nothing', () => {
    expect(resolve('action: remove\nref: zzzzzz')).toMatchObject({ ok: false, problem: expect.stringMatching(/isn't on the calendar/) })
  })

  it('says when a ref names two sessions', () => {
    const twin = { ...run }
    expect(resolveEdit(parsed(`action: remove\nref: ${entryRef('run1')}`), [run, twin], done, TODAY)).toMatchObject({ ok: false, problem: expect.stringMatching(/can't tell/) })
  })

  it('leaves a done session alone', () => {
    expect(resolve(`action: remove\nref: ${entryRef('done1')}`)).toMatchObject({ ok: false, problem: expect.stringMatching(/done already/) })
  })

  it('refuses to change an intervals.icu import, and warns on moving one', () => {
    expect(resolve(`action: change\nref: ${entryRef('icu1')}\nname: Mine`)).toMatchObject({ ok: false, problem: expect.stringMatching(/intervals\.icu/) })
    expect(resolve(`action: move\nref: ${entryRef('icu1')}\ndate: 2026-11-21`)).toMatchObject({ ok: true, warnings: [expect.stringMatching(/intervals\.icu/)] })
  })

  it('plans nothing on a day that has passed', () => {
    expect(resolve('action: add\ndate: 2026-11-17\nsport: run\nduration: 30m')).toMatchObject({ ok: false, problem: expect.stringMatching(/passed/) })
    expect(resolve(`action: change\nref: ${entryRef('old1')}\nname: Late`)).toMatchObject({ ok: false, problem: expect.stringMatching(/passed/) })
  })

  it('still moves a missed session to a day to come', () => {
    expect(resolve(`action: move\nref: ${entryRef('old1')}\ndate: 2026-11-21`)).toMatchObject({ ok: true })
  })

  it('says when a move goes nowhere', () => {
    expect(resolve(`action: move\nref: ${entryRef('run1')}\ndate: 2026-11-19`)).toMatchObject({ ok: false, problem: expect.stringMatching(/on that day already/) })
  })

  it('needs steps to change the sport', () => {
    expect(resolve(`action: change\nref: ${entryRef('run1')}\nsport: swim`)).toMatchObject({ ok: false, problem: expect.stringMatching(/change of sport/) })
  })

  it('needs steps for a ride in a plan', () => {
    const planned = entry('p', '2026-11-19', { planId: 'plan1', planItemId: 'i1' })
    expect(resolveEdit(parsed(`action: change\nref: ${entryRef('p')}\nsport: ride\nduration: 45m`), [planned], done, TODAY)).toMatchObject({ ok: false, problem: expect.stringMatching(/needs steps/) })
  })
})

describe('withSessionHeader', () => {
  it('sets the name and notes, keeping everything else', () => {
    expect(withSessionHeader('sport: run\nname: Old\nduration: 40m\n\n- 40m Z2 HR\n', { name: 'New', notes: 'Easy' })).toBe('sport: run\nname: New\nnotes: Easy\nduration: 40m\n\n- 40m Z2 HR\n')
    expect(withSessionHeader('sport: run\n\n- 40m Z2 HR', { name: 'New' })).toBe('sport: run\nname: New\n\n- 40m Z2 HR')
  })
})
