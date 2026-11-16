import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CalendarSync, CheckCircle2, CircleAlert } from 'lucide-react'
import type { GoogleStatus } from '@shared/ipc/contract'
import { bridge } from '../../platform/bridge'
import { useSettings } from '../../stores/settings'
import { Button } from '../../ui/Button'

/**
 * Google Calendar from the calendar page: sign in here instead of in Settings,
 * or see that the plan is going across. Settings keeps the full section (the
 * rider's own app, the switch, signing out). Mac app only.
 */
export function GoogleCalendarLink({ onNotice }: { onNotice: (n: { tone: 'good' | 'bad'; text: string }) => void }) {
  const enabled = useSettings((s) => s.googleCalendar.enabled)
  const navigate = useNavigate()
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void bridge()
      .invoke('google.status', {})
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    const off = bridge().on('google.calendar.changed', (s) => live && setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])
  if (!status) return null
  const toSettings = () => void navigate({ to: '/settings', search: { tab: 'integrations' } })

  if (status.connected) {
    const account = status.email ? `Signed in as ${status.email}. ` : ''
    if (!enabled || status.lastError) {
      return (
        <Button size="sm" variant="ghost" onClick={toSettings} title={`${account}${status.lastError ?? 'Sending planned training is switched off.'} Opens Settings.`} data-testid="google-calendar-link">
          <CircleAlert className="size-3.5 text-warn" /> {enabled ? 'Google Calendar isn’t updating' : 'Google Calendar is off'}
        </Button>
      )
    }
    return (
      <Button size="sm" variant="ghost" onClick={() => void bridge().invoke('files.openUrl', { url: 'https://calendar.google.com/' })} title={`${account}Your planned sessions are in the calendar named CrankHog. Opens Google Calendar.`} data-testid="google-calendar-link">
        <CheckCircle2 className="size-3.5 text-good" /> Connected to Google Calendar
      </Button>
    )
  }

  // without a Google app in this build, the one-time setup lives in Settings
  if (!status.configured) {
    return (
      <Button size="sm" onClick={toSettings} title="Needs a one-time setup in Settings first" data-testid="google-calendar-link">
        <CalendarSync className="size-3.5" /> Connect Google Calendar
      </Button>
    )
  }
  const connect = async () => {
    setBusy(true)
    const r = await bridge().invoke('google.connect', {})
    setBusy(false)
    onNotice(
      r.ok
        ? { tone: 'good', text: `Signed in to Google${r.email ? ` as ${r.email}` : ''}. Your planned training is on its way to a calendar named CrankHog.` }
        : { tone: 'bad', text: r.error ?? 'Google sign-in didn’t finish.' },
    )
    setStatus(await bridge().invoke('google.status', {}))
  }
  return (
    <Button size="sm" disabled={busy} onClick={() => void connect()} title="Your planned workouts and sessions, as all-day events in a Google calendar named CrankHog" data-testid="google-calendar-link">
      <CalendarSync className="size-3.5" /> {busy ? 'Finish in your browser…' : 'Connect Google Calendar'}
    </Button>
  )
}
