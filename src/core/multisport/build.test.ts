import { describe, expect, it } from 'vitest'
import { describeSession, sessionFromFile } from './build'
import { SESSION_EXAMPLES } from './examples'

const t = { runPaceSPerKm: 255, swimCssSPer100m: 100, lthr: 170 }

describe('sessionFromFile', () => {
  it('builds a stored session, its day and what it adds up to', () => {
    const ex = SESSION_EXAMPLES[1]!
    const r = sessionFromFile(ex.fileName, ex.text, t, 5)
    expect(r.errors).toEqual([])
    expect(r.date).toBe('2026-12-03')
    expect(r.workout).toMatchObject({ sport: 'swim', name: 'CSS 10x100', pool: '25m', source: 'import', createdAt: 5 })
    expect(r.estimate).toMatchObject({ durationS: 2210, distanceM: 1800 })
  })

  it('gives the same id to the same file, so importing it again replaces it', () => {
    const ex = SESSION_EXAMPLES[0]!
    expect(sessionFromFile(ex.fileName, ex.text, t, 1).workout!.id).toBe(sessionFromFile('other name.txt', ex.text.replace(/\n/g, '\r\n'), t, 2).workout!.id)
  })

  it('stores nothing from a file with errors, and passes the threshold warnings on', () => {
    expect(sessionFromFile('x.txt', 'sport: run\n\n- 10m Z2 HR 4:00/km Pace', t, 1).workout).toBeNull()
    const ex = SESSION_EXAMPLES[1]!
    const r = sessionFromFile(ex.fileName, ex.text, {}, 1)
    expect(r.workout).not.toBeNull()
    expect(r.warnings.map((w) => w.text)).toEqual([expect.stringMatching(/no swim threshold pace \(CSS\) is set/)])
  })
})

describe('describeSession', () => {
  it('reads a stored session back with today’s thresholds', () => {
    const ex = SESSION_EXAMPLES[3]!
    const w = sessionFromFile(ex.fileName, ex.text, {}, 1).workout!
    expect(describeSession(w, {}).estimate!.durationS).toBeNull()
    expect(describeSession(w, t).estimate!.durationS).toBe(2720)
  })
})
