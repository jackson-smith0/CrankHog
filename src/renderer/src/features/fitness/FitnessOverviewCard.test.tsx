import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { FitnessOverviewCard } from './FitnessOverviewCard'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => async () => undefined, Link: ({ children }: { children: unknown }) => children }))

beforeEach(async () => {
  await db().delete()
  await db().open()
})
afterEach(() => cleanup())

describe('FitnessOverviewCard', () => {
  it('says it reads rides only once other sports count in the numbers below', async () => {
    const { unmount } = render(<FitnessOverviewCard rideCount={0} />)
    await waitFor(() => expect(screen.getByTestId('fitness-overview').textContent).toContain('read of the numbers below'))
    unmount()
    await db().activities.put({ id: 'a1', startedAt: Date.now() - 86_400_000, sport: 'racket', subSport: 'squash', name: 'Squash', movingS: 3600, distanceM: null, avgHr: null, maxHr: null, hrLoad: null, trainingEffect: null, garminLoad: null, device: null, source: 'manual', group: 'other', manualLoad: 80 })
    render(<FitnessOverviewCard rideCount={0} />)
    await waitFor(() => expect(screen.getByTestId('fitness-overview').textContent).toContain('read of your rides only. The numbers below count every sport'))
  })
})
