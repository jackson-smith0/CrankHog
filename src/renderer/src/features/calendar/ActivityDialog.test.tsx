import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type OtherActivity } from '../../db/db'
import { HIDDEN_KEY, addManualActivity } from '../../plan/activities-repo'
import { ActivityDialog } from './ActivityDialog'

beforeEach(async () => {
  await db().delete()
  await db().open()
})
afterEach(() => cleanup())

const fitRun: OtherActivity = { id: 'a1', startedAt: new Date(2026, 10, 14, 7).getTime(), sport: 'running', subSport: null, name: 'Morning run', movingS: 1800, distanceM: 5000, avgHr: 150, maxHr: 170, hrLoad: 40, trainingEffect: null, garminLoad: null, device: null, fileName: 'run.fit', source: 'fit', group: 'run' }

describe('ActivityDialog', () => {
  it('says where an activity came from, and that importing its file brings it back', () => {
    render(<ActivityDialog activity={fitRun} onClose={() => undefined} />)
    expect(screen.getByTestId('activity-details').textContent).toMatch(/FromA FIT file/)
    expect(screen.queryByTestId('activity-edit')).toBeNull()
    fireEvent.click(screen.getByTestId('activity-remove'))
    expect(screen.getByTestId('activity-remove-warning').textContent).toMatch(/Importing its file again brings it back/)
  })

  it('warns that one from intervals.icu won’t come back, and remembers it', async () => {
    const icu: OtherActivity = { ...fitRun, id: 'icu-9', fileName: undefined, hrLoad: null, icuLoad: 55, source: 'intervals', externalId: 'i9' }
    await db().activities.put(icu)
    const onClose = vi.fn()
    render(<ActivityDialog activity={icu} onClose={onClose} />)
    expect(screen.getByTestId('activity-details').textContent).toMatch(/55 TSS, from intervals.icu/)
    fireEvent.click(screen.getByTestId('activity-remove'))
    expect(screen.getByTestId('activity-remove-warning').textContent).toMatch(/won’t come back from intervals.icu/)
    await act(async () => fireEvent.click(screen.getByTestId('activity-remove-confirm')))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect((await db().kv.get(HIDDEN_KEY))?.value).toEqual(['i9'])
  })

  it('edits one entered by hand', async () => {
    const a = await addManualActivity({ date: '2026-11-14', group: 'other', label: 'Squash', durationS: 2700, effort: 'moderate' })
    const onClose = vi.fn()
    render(<ActivityDialog activity={a} onClose={onClose} />)
    expect(screen.getByTestId('activity-details').textContent).toMatch(/FromEntered by hand/)
    fireEvent.click(screen.getByTestId('activity-edit'))
    fireEvent.change(screen.getByTestId('activity-time'), { target: { value: '1:00' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Hard' }))
    await act(async () => fireEvent.click(screen.getByTestId('activity-save')))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await db().activities.get(a.id)).toMatchObject({ movingS: 3600, manualLoad: 80, label: 'Squash' })
  })
})
