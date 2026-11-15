import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_EXAMPLES } from '@core/multisport/examples'
import { updateProfile } from '../../db/athlete-repo'
import { db } from '../../db/db'
import { ImportReport } from './ImportReport'
import { SessionsPanel } from './SessionsPanel'

beforeEach(async () => {
  await db().delete()
  await db().open()
})
afterEach(() => cleanup())

describe('Paste a session', () => {
  it('reads what you type as you type it, and saves and plans it on its day', async () => {
    await updateProfile({ runThresholdPaceSPerKm: 255, lthr: 170 })
    render(<SessionsPanel onNotice={vi.fn()} />)
    fireEvent.click(screen.getByTestId('paste-session'))
    fireEvent.change(screen.getByTestId('paste-text'), { target: { value: 'sport: run\n\n- 10m Z2 HR 4:00/km Pace' } })
    expect(screen.getByTestId('paste-errors').textContent).toContain('line 3: one target per step.')
    expect((screen.getByTestId('paste-save') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('paste-text'), { target: { value: SESSION_EXAMPLES[0]!.text.replace('name: Threshold 4x8', 'name: Threshold 4x8\ndate: 2026-12-02') } })
    await waitFor(() => expect(screen.getByTestId('paste-numbers').textContent).toMatch(/Run · 1h 05m/))
    expect(screen.getAllByTestId('session-steps')[0]!.textContent).toContain('8m 4:10-4:20/km Pace')
    await act(async () => fireEvent.click(screen.getByTestId('paste-plan')))
    await waitFor(async () => expect(await db().schedule.count()).toBe(1))
    expect(await db().schedule.toArray()).toEqual([expect.objectContaining({ date: '2026-12-02', sport: 'run', name: 'Threshold 4x8' })])
    expect(await db().sessionWorkouts.count()).toBe(1)
  })
})

describe('ImportReport', () => {
  it('lists every file, where it went, and each reason by line', () => {
    render(
      <ImportReport
        onDismiss={() => undefined}
        lines={[
          { file: '2026-12-02_Threshold 4x8.txt', name: 'Threshold 4x8', kind: 'session', outcome: 'day', date: '2026-12-02', errors: [], warnings: [{ line: 8, text: '"400m" is 400 minutes. For metres write 400mtr.' }] },
          { file: 'Easy 8k.txt', kind: 'session', outcome: 'skipped', errors: [{ text: 'No date: name it YYYY-MM-DD_Name.txt or add a "date:" line, or import it on the Workouts page.' }], warnings: [] },
        ]}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('1 on the calendar, 1 skipped.')
    const [day, skipped] = screen.getAllByTestId('import-line')
    expect(day!.textContent).toMatch(/on .*2/)
    expect(day!.textContent).toContain('line 8: "400m" is 400 minutes.')
    expect(skipped!.textContent).toContain('skipped')
    expect(skipped!.textContent).toContain('No date: name it YYYY-MM-DD_Name.txt')
    expect(screen.getByTestId('format-guide-link')).toBeTruthy()
  })
})
