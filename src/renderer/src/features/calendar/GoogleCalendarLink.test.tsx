import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrankHogBridge, GoogleStatus } from '@shared/ipc/contract'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { settingsStore } from '../../stores/settings'
import { GoogleCalendarLink } from './GoogleCalendarLink'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const invoke = vi.fn()
const signedOut: GoogleStatus = { configured: true, builtInApp: true, connected: false, syncing: false }
const signedIn: GoogleStatus = { ...signedOut, connected: true, email: 'rider@example.com', lastSyncAt: 1, eventCount: 3 }

/** Answers google.status from `status`; google.connect with `connect`. */
function fakeMain(status: () => GoogleStatus, connect: unknown = { ok: true }) {
  invoke.mockImplementation(async (channel: string) => (channel === 'google.status' ? status() : channel === 'google.connect' ? connect : { ok: true }))
}

const syncOn = (enabled: boolean) => settingsStore.setState({ ...DEFAULT_SETTINGS, googleCalendar: { enabled } }, true)

beforeEach(() => {
  invoke.mockReset()
  navigate.mockReset()
  window.crankhog = { invoke, on: () => () => undefined, send: () => undefined } as unknown as CrankHogBridge
  syncOn(true)
})
afterEach(() => cleanup())

describe('GoogleCalendarLink', () => {
  it('signs in from the calendar page and then says it is connected', async () => {
    let status = signedOut
    fakeMain(() => status, { ok: true, email: 'rider@example.com' })
    const onNotice = vi.fn()
    render(<GoogleCalendarLink onNotice={onNotice} />)
    const button = await screen.findByText('Connect Google Calendar')
    status = signedIn
    await act(async () => fireEvent.click(button))
    expect(invoke).toHaveBeenCalledWith('google.connect', {})
    expect(onNotice).toHaveBeenCalledWith({ tone: 'good', text: 'Signed in to Google as rider@example.com. Your planned training is on its way to a calendar named CrankHog.' })
    await screen.findByText('Connected to Google Calendar')
  })

  it('reports a sign-in that failed and stays signed out', async () => {
    fakeMain(() => signedOut, { ok: false, error: 'CrankHog needs permission to manage its own calendar.' })
    const onNotice = vi.fn()
    render(<GoogleCalendarLink onNotice={onNotice} />)
    const button = await screen.findByText('Connect Google Calendar')
    await act(async () => fireEvent.click(button))
    expect(onNotice).toHaveBeenCalledWith({ tone: 'bad', text: 'CrankHog needs permission to manage its own calendar.' })
    expect(screen.getByText('Connect Google Calendar')).toBeTruthy()
  })

  it('sends a build without a Google app to the setup in Settings', async () => {
    fakeMain(() => ({ ...signedOut, configured: false, builtInApp: false }))
    render(<GoogleCalendarLink onNotice={() => undefined} />)
    fireEvent.click(await screen.findByText('Connect Google Calendar'))
    expect(navigate).toHaveBeenCalledWith({ to: '/settings', search: { tab: 'integrations' } })
    expect(invoke).not.toHaveBeenCalledWith('google.connect', {})
  })

  it('opens Google Calendar once connected', async () => {
    fakeMain(() => signedIn)
    render(<GoogleCalendarLink onNotice={() => undefined} />)
    fireEvent.click(await screen.findByText('Connected to Google Calendar'))
    expect(invoke).toHaveBeenCalledWith('files.openUrl', { url: 'https://calendar.google.com/' })
  })

  it('says so when the sync is switched off or failing, and points to Settings', async () => {
    syncOn(false)
    fakeMain(() => signedIn)
    render(<GoogleCalendarLink onNotice={() => undefined} />)
    fireEvent.click(await screen.findByText('Google Calendar is off'))
    expect(navigate).toHaveBeenCalledWith({ to: '/settings', search: { tab: 'integrations' } })
    cleanup()

    syncOn(true)
    fakeMain(() => ({ ...signedIn, lastError: 'Google said no.' }))
    render(<GoogleCalendarLink onNotice={() => undefined} />)
    expect((await screen.findByText('Google Calendar isn’t updating')).closest('button')?.title).toContain('Google said no.')
  })

  it('shows nothing when main has no Google status (the web build)', async () => {
    invoke.mockRejectedValue(new Error('no such channel'))
    const { container } = render(<GoogleCalendarLink onNotice={() => undefined} />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('google.status', {}))
    expect(container.textContent).toBe('')
  })
})
