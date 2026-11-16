import { describe, expect, it } from 'vitest'
import {
  addDays,
  completions,
  dateKey,
  dateKeyToMs,
  fromIntervalsEvent,
  pushedChanges,
  pushedExternalId,
  scheduleStatus,
  todaysWorkout,
  type ScheduleRide,
  type ScheduledWorkout,
} from './schedule'

const at = (y: number, m: number, d: number, h = 18) => new Date(y, m - 1, d, h).getTime()

const entry = (id: string, date: string, workoutId: string, extra: Partial<ScheduledWorkout> = {}): ScheduledWorkout => ({
  id,
  date,
  workoutId,
  workout: null,
  name: id,
  source: 'manual',
  createdAt: 0,
  ...extra,
})

const ride = (id: string, startedAt: number, workoutId: string | undefined, extra: Partial<ScheduleRide> = {}): ScheduleRide => ({
  id,
  startedAt,
  workoutId,
  simulated: false,
  ...extra,
})

describe('date keys', () => {
  it('name the local calendar day, late evening included', () => {
    expect(dateKey(at(2026, 11, 14, 23))).toBe('2026-11-14')
    expect(dateKey(at(2026, 1, 3, 0))).toBe('2026-01-03')
    expect(dateKeyToMs('2026-11-14')).toBe(new Date(2026, 10, 14).getTime())
  })

  it('step whole days across month ends and clock changes', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('completions', () => {
  it('a ride of the planned workout on its day completes it', () => {
    const done = completions([entry('a', '2026-11-14', 'builtin:sweet-spot-3x12')], [ride('r1', at(2026, 11, 14), 'builtin:sweet-spot-3x12')])
    expect(done.get('a')).toBe('r1')
  })

  it('a ride of another workout, on another day, or simulated, does not', () => {
    const e = [entry('a', '2026-11-14', 'builtin:sweet-spot-3x12')]
    expect(completions(e, [ride('r1', at(2026, 11, 14), 'builtin:vo2max-5x4')]).size).toBe(0)
    expect(completions(e, [ride('r1', at(2026, 11, 15), 'builtin:sweet-spot-3x12')]).size).toBe(0)
    expect(completions(e, [ride('r1', at(2026, 11, 14), 'builtin:sweet-spot-3x12', { simulated: true })]).size).toBe(0)
  })

  it('one ride completes one entry, when the same workout is planned twice in a day', () => {
    const e = [entry('a', '2026-11-14', 'w'), entry('b', '2026-11-14', 'w')]
    const done = completions(e, [ride('r1', at(2026, 11, 14, 7), 'w')])
    expect([...done.entries()]).toEqual([['a', 'r1']])
    expect(completions(e, [ride('r1', at(2026, 11, 14, 7), 'w'), ride('r2', at(2026, 11, 14, 19), 'w')]).size).toBe(2)
  })

  it('matches an imported workout by the workout it carries', () => {
    const imported = entry('a', '2026-11-14', '', { workoutId: null, workout: { id: 'intervals:42', name: 'Over-unders', tags: [], sportType: 'bike', segments: [], source: 'import' }, source: 'intervals' })
    expect(completions([imported], [ride('r1', at(2026, 11, 14), 'intervals:42')]).get('a')).toBe('r1')
  })

  const session = (id: string, date: string, sport: ScheduledWorkout['sport'], createdAt = 0) => entry(id, date, '', { workoutId: null, sport, session: { durationS: 3600 }, createdAt })
  const act = (id: string, startedAt: number, group: 'ride' | 'run' | 'swim' | 'other') => ({ id, startedAt, group })

  it('a run, swim or squash game on its day completes a planned session of that sport', () => {
    const e = [session('run', '2026-11-14', 'run'), session('swim', '2026-11-14', 'swim'), session('sq', '2026-11-15', 'other')]
    const done = completions(e, [], [act('a1', at(2026, 11, 14, 7), 'run'), act('a2', at(2026, 11, 15, 20), 'other'), act('a3', at(2026, 11, 15), 'swim')])
    expect([...done.entries()].sort()).toEqual([
      ['run', 'a1'],
      ['sq', 'a2'],
    ])
  })

  it('one activity completes one session, earliest planned first', () => {
    const e = [session('b', '2026-11-14', 'run', 2), session('a', '2026-11-14', 'run', 1)]
    expect([...completions(e, [], [act('a1', at(2026, 11, 14), 'run')]).entries()]).toEqual([['a', 'a1']])
  })

  it('a ride planned without a workout is done by any real ride that day, after bike workouts claim theirs', () => {
    const e = [entry('w', '2026-11-14', 'w', { createdAt: 5 }), session('long', '2026-11-14', 'ride', 1)]
    const rides = [ride('r1', at(2026, 11, 14, 7), 'w')]
    // the only ride is the workout's, so the free ride session stays open
    expect([...completions(e, rides).entries()]).toEqual([['w', 'r1']])
    const done = completions(e, [...rides, ride('r2', at(2026, 11, 14, 19), 'other')])
    expect(done.get('long')).toBe('r2')
    // an outdoor ride from intervals.icu does it too
    expect(completions([session('long', '2026-11-14', 'ride')], [], [act('a1', at(2026, 11, 14), 'ride')]).get('long')).toBe('a1')
  })

  it('never completes a bike workout with an activity', () => {
    expect(completions([entry('w', '2026-11-14', 'w')], [], [act('a1', at(2026, 11, 14), 'ride')]).size).toBe(0)
  })
})

describe('scheduleStatus', () => {
  const e = entry('a', '2026-11-14', 'w')
  it('is done once a ride completes it, whatever the day', () => {
    expect(scheduleStatus(e, true, '2026-11-20')).toBe('done')
  })
  it('is today, planned for later, or missed once its day has passed', () => {
    expect(scheduleStatus(e, false, '2026-11-14')).toBe('today')
    expect(scheduleStatus(e, false, '2026-11-13')).toBe('planned')
    expect(scheduleStatus(e, false, '2026-11-15')).toBe('missed')
  })
})

describe('todaysWorkout', () => {
  it('is the first of today’s workouts still to ride', () => {
    const e = [entry('a', '2026-11-14', 'w1'), entry('b', '2026-11-14', 'w2'), entry('c', '2026-11-15', 'w3')]
    expect(todaysWorkout(e, [], at(2026, 11, 14, 6))?.id).toBe('a')
    expect(todaysWorkout(e, [ride('r', at(2026, 11, 14, 7), 'w1')], at(2026, 11, 14, 9))?.id).toBe('b')
  })
  it('is null on a rest day or once everything is ridden', () => {
    const e = [entry('a', '2026-11-14', 'w1')]
    expect(todaysWorkout(e, [], at(2026, 11, 13))).toBeNull()
    expect(todaysWorkout(e, [ride('r', at(2026, 11, 14, 7), 'w1')], at(2026, 11, 14, 9))).toBeNull()
  })
})

const ZWO = `<workout_file><name>From the file</name><sportType>bike</sportType><workout>
  <Warmup Duration="600" PowerLow="0.5" PowerHigh="0.75"/>
  <SteadyState Duration="1200" Power="0.9"/>
</workout></workout_file>`

describe('fromIntervalsEvent', () => {
  it('turns a planned ride with a workout file into a scheduled workout on its local day', () => {
    const r = fromIntervalsEvent({ id: 42, start_date_local: '2026-11-18T00:00:00', name: 'Tempo', type: 'Ride', zwo: ZWO }, 1000)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.entry).toMatchObject({ id: 'intervals:42', date: '2026-11-18', name: 'Tempo', source: 'intervals', externalId: '42', workoutId: null, createdAt: 1000 })
    expect(r.entry.workout?.id).toBe('intervals:42')
    expect(r.entry.workout?.name).toBe('Tempo')
    expect(r.entry.workout?.segments).toHaveLength(2)
  })

  it('reads the intervals.icu workout text when there is no file', () => {
    const r = fromIntervalsEvent({ id: 7, start_date_local: '2026-11-19T00:00:00', name: 'Sweet spot', type: 'VirtualRide', description: '- 10m ramp 50-75%\n3x\n- 8m 90%\n- 4m 55%' }, 0)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.entry.workout?.segments.length).toBeGreaterThan(0)
  })

  it('brings in runs, swims and other sessions with their steps as text and intervals.icu’s time and load', () => {
    expect(fromIntervalsEvent({ id: 1, start_date_local: '2026-11-18T00:00:00', name: 'Easy run', type: 'Run', description: '- 30m Z2 HR', moving_time: 1800, icu_training_load: 25 }, 7)).toEqual({
      kind: 'ok',
      entry: { id: 'intervals:1', date: '2026-11-18', workoutId: null, workout: null, name: 'Easy run', source: 'intervals', externalId: '1', sport: 'run', session: { text: '- 30m Z2 HR', durationS: 1800, load: 25 }, createdAt: 7 },
    })
    const swim = fromIntervalsEvent({ id: 2, start_date_local: '2026-11-19T00:00:00', name: 'Swim', type: 'Swim' }, 0)
    expect(swim.kind === 'ok' && [swim.entry.sport, swim.entry.session]).toEqual(['swim', {}])
    const yoga = fromIntervalsEvent({ id: 3, start_date_local: '2026-11-19T00:00:00', name: 'Yoga', type: 'Yoga' }, 0)
    expect(yoga.kind === 'ok' && yoga.entry.sport).toBe('other')
  })

  it('skips a session CrankHog sent to intervals.icu itself', () => {
    expect(fromIntervalsEvent({ id: 9, start_date_local: '2026-11-18T00:00:00', name: 'Easy run', type: 'Run', external_id: 'freegaz-plan-s1' }, 0)).toEqual({ kind: 'skip', reason: 'sent from CrankHog' })
  })

  it('skips rides with no structure to play, and events without a date', () => {
    expect(fromIntervalsEvent({ id: 2, start_date_local: '2026-11-18T00:00:00', name: 'Ride outside', type: 'Ride', description: 'Coffee ride with the club' }, 0)).toEqual({ kind: 'skip', reason: 'no workout steps' })
    expect(fromIntervalsEvent({ id: 3, start_date_local: 'soon', name: 'x', type: 'Ride', zwo: ZWO }, 0)).toEqual({ kind: 'skip', reason: 'no date' })
  })
})

describe('pushedChanges', () => {
  it('finds sent sessions that moved or went, and ignores ones never sent', () => {
    const before = [
      { id: 'a', date: '2026-12-01', pushedEventId: 'e1' },
      { id: 'b', date: '2026-12-02', pushedEventId: 'e2' },
      { id: 'c', date: '2026-12-03', pushedEventId: 'e3' },
      { id: 'd', date: '2026-12-04' },
    ]
    const after = [
      { id: 'a', date: '2026-12-01' },
      { id: 'b', date: '2026-12-05' },
    ]
    expect(pushedChanges(before, after)).toEqual({ moved: [{ entryId: 'b', eventId: 'e2', date: '2026-12-05' }], removed: [{ eventId: 'e3' }] })
  })

  it('makes a safe external id from any entry id', () => {
    expect(pushedExternalId('plan-p1-i2')).toBe('freegaz-plan-plan-p1-i2')
    expect(pushedExternalId('a:b c')).toBe('freegaz-plan-a-b-c')
  })
})
