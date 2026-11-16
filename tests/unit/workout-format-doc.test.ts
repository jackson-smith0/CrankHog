// docs/WORKOUT-FORMAT.md is the rider's guide to session files. Its examples
// must be the ones the app ships and the tests parse, word for word.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SESSION_EXAMPLES } from '@core/multisport/examples'
import { parseSession } from '@core/multisport/parse'

const doc = readFileSync(join(import.meta.dirname, '../../docs/WORKOUT-FORMAT.md'), 'utf8')

describe('docs/WORKOUT-FORMAT.md', () => {
  it.each(SESSION_EXAMPLES.map((e) => [e.fileName, e] as const))('quotes %s exactly as the app ships it', (_, e) => {
    expect(doc).toContain(`### \`${e.fileName}\``)
    expect(doc).toContain('```\n' + e.text + '```')
  })

  it('shows every report message the parser gives for the files it describes', () => {
    const shown = (text: string, fileText: string) => {
      const p = parseSession('x.txt', fileText)
      const all = [...p.errors, ...p.warnings].map((m) => m.text)
      expect(all.some((m) => text.includes(m))).toBe(true)
      expect(doc).toContain(text)
    }
    shown('"400m" is 400 minutes. For metres write 400mtr.', 'sport: run\n\n- 400m 4:00/km Pace')
    shown('sport must be run, swim or other.', 'sport: tennis\n\n- 10m')
    shown("a repeat inside a repeat isn't supported. Write the inner set out, or leave a blank line before a new set.", 'sport: swim\n\nMain 3x\n- 100mtr easy\n2x\n- 50mtr easy')
    shown('one target per step. "Z2 HR 4:30/km Pace" has two.', 'sport: run\n\n- 10m Z2 HR 4:30/km Pace')
    shown('No steps, and no duration or distance: add "duration: 45m" or some steps.', 'sport: other')
    shown("distance 160mtr isn't a whole number of 25m lengths.", 'sport: swim\npool: 25m\n\n- 160mtr easy')
  })
})
