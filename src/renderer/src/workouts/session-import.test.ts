import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { SESSION_EXAMPLES } from '@core/multisport/examples'
import { updateProfile } from '../db/athlete-repo'
import { db } from '../db/db'
import { NO_DATE, importWorkoutFiles, summarizeImport } from './session-import'

beforeEach(async () => {
  await db().delete()
  await db().open()
})

const files = SESSION_EXAMPLES.map((e) => ({ name: e.fileName, text: e.text }))

describe('importing onto the calendar', () => {
  it('puts the three dated guide examples on their days, and lists the undated one as having no date', async () => {
    await updateProfile({ runThresholdPaceSPerKm: 255, swimCssSPer100m: 100, lthr: 170 })
    const lines = await importWorkoutFiles(files, 'calendar')
    expect(lines.map((l) => [l.file, l.outcome, l.date ?? null])).toEqual([
      ['2026-12-02_Threshold 4x8.txt', 'day', '2026-12-02'],
      ['2026-12-03_CSS 10x100.txt', 'day', '2026-12-03'],
      ['2026-12-04_Squash.txt', 'day', '2026-12-04'],
      ['Easy 8k.txt', 'skipped', null],
    ])
    expect(lines[3]!.errors).toEqual([{ text: NO_DATE }])
    const planned = (await db().schedule.orderBy('date').toArray()).map((e) => [e.date, e.sport, e.name, e.session?.durationS])
    expect(planned).toEqual([
      ['2026-12-02', 'run', 'Threshold 4x8', 3900],
      ['2026-12-03', 'swim', 'CSS 10x100', 2210],
      ['2026-12-04', 'other', 'Squash', 3600],
    ])
    expect((await db().schedule.toArray()).find((e) => e.sport === 'swim')!.session!.text).toMatch(/^Warmup\n- 400mtr easy/)
    expect(await db().sessionWorkouts.count()).toBe(3)
    expect(summarizeImport(lines)).toBe('3 on the calendar, 1 skipped.')
  })

  it('skips a file with errors whole, with its line-numbered reason, and imports one with warnings', async () => {
    const lines = await importWorkoutFiles(
      [
        { name: '2026-12-05_Bad.txt', text: 'sport: run\n\n- 10m Z2 HR 4:30/km Pace' },
        { name: '2026-12-06_Long.txt', text: 'sport: run\n\n- 10m Z2 HR\n- 400m 4:00/km Pace' },
      ],
      'calendar',
    )
    expect(lines[0]).toMatchObject({ outcome: 'skipped', errors: [{ line: 3, text: 'one target per step. "Z2 HR 4:30/km Pace" has two.' }] })
    expect(lines[1]).toMatchObject({ outcome: 'day', date: '2026-12-06' })
    expect(lines[1]!.warnings[0]).toEqual({ line: 4, text: '"400m" is 400 minutes. For metres write 400mtr.' })
    expect(await db().schedule.count()).toBe(1)
  })

  it('puts a dated bike workout on its day too, named without its date', async () => {
    const lines = await importWorkoutFiles([{ name: '2026-12-07_Sweet spot.txt', text: '- 10m 60%\n- 20m 90%' }, { name: 'Tempo.txt', text: '- 30m 80%' }], 'calendar')
    expect(lines.map((l) => [l.kind, l.outcome, l.name ?? null])).toEqual([
      ['bike', 'day', 'Sweet spot'],
      ['bike', 'skipped', null],
    ])
    const [e] = await db().schedule.toArray()
    expect(e).toMatchObject({ date: '2026-12-07', name: 'Sweet spot' })
  })

  it('replaces a session imported again rather than adding a copy to the library', async () => {
    await importWorkoutFiles(files.slice(0, 1), 'calendar')
    await importWorkoutFiles(files.slice(0, 1), 'calendar')
    expect(await db().sessionWorkouts.count()).toBe(1)
  })
})

describe('importing into the library', () => {
  it('puts every good file in the library, dated or not', async () => {
    const lines = await importWorkoutFiles(files, 'library')
    expect(lines.map((l) => l.outcome)).toEqual(['library', 'library', 'library', 'library'])
    expect(await db().schedule.count()).toBe(0)
    expect(lines[1]!.warnings.map((w) => w.text)).toEqual([expect.stringMatching(/no swim threshold pace \(CSS\)/)])
  })
})
