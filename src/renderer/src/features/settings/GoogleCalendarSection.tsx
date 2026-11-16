import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react'
import type { GoogleStatus } from '@shared/ipc/contract'
import { syncGoogleNow } from '../../plan/google-mirror'
import { bridge } from '../../platform/bridge'
import { patchSettings, useSettings } from '../../stores/settings'
import { Button } from '../../ui/Button'
import { Field, Input, Section, Switch } from '../../ui/form'

const open = (url: string) => void bridge().invoke('files.openUrl', { url })

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

/** Google sign-in, and the CrankHog calendar planned training is mirrored to. Desktop app only. */
export function GoogleCalendarSection() {
  const sync = useSettings((s) => s.googleCalendar)
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => setStatus(await bridge().invoke('google.status', {}))
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

  const saveApp = async () => {
    setMsg(null)
    try {
      await bridge().invoke('google.setApp', { clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      setClientId('')
      setClientSecret('')
      await refresh()
      setMsg('Google app saved. Now sign in.')
    } catch {
      setMsg('That client ID or secret doesn’t look right. The ID ends in .apps.googleusercontent.com; the secret usually starts with GOCSPX-.')
    }
  }

  const connect = async () => {
    setBusy(true)
    setMsg('Finish signing in in your browser…')
    const r = await bridge().invoke('google.connect', {})
    setBusy(false)
    setMsg(r.ok ? `Signed in${r.email ? ` as ${r.email}` : ''}. Your planned training is on its way to a calendar named CrankHog.` : (r.error ?? 'Sign-in failed'))
    await refresh()
  }

  const disconnect = async () => {
    await bridge().invoke('google.disconnect', {})
    setMsg('Signed out. The CrankHog calendar stays in Google; delete it there if you no longer want it.')
    await refresh()
  }

  return (
    <Section title="Google Calendar" description="Your planned workouts and sessions, as all-day events in a calendar named CrankHog. Move or remove one here and Google follows within seconds.">
      {status?.connected ? (
        <Field label="Status">
          <div className="flex flex-wrap items-center gap-3 pt-2 text-sm">
            <CheckCircle2 className="size-4 text-good" /> Signed in{status.email ? ` as ${status.email}` : ''}
            <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
              Sign out
            </Button>
          </div>
        </Field>
      ) : (
        <>
          {status && !status.builtInApp && (
            <>
              <Field label="One-time setup" hint="This build doesn't carry CrankHog's own Google app, so you use your own. It's free and takes a few minutes.">
                <ol className="list-decimal space-y-1.5 pl-5 pt-2 text-sm text-ink-dim">
                  <li>
                    In the{' '}
                    <button type="button" className="text-accent underline" onClick={() => open('https://console.cloud.google.com/apis/library/calendar-json.googleapis.com')}>
                      Google Cloud console
                    </button>
                    , make a project and enable the Google Calendar API.
                  </li>
                  <li>Under OAuth consent screen, choose External and add your own address as a test user.</li>
                  <li>
                    Under Credentials, create an OAuth client ID of type <b className="text-ink">Desktop app</b>.
                  </li>
                  <li>Paste its client ID and secret below, save, then sign in.</li>
                </ol>
              </Field>
              <Field label="Client ID">
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" aria-label="Google client ID" className="max-w-md" />
              </Field>
              <Field label="Client secret" hint="Stored encrypted in your Keychain; never shown again.">
                <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" placeholder={status.configured ? '•••••• (saved)' : ''} aria-label="Google client secret" className="max-w-md" />
              </Field>
            </>
          )}
          <Field label="">
            <div className="flex gap-2">
              {status && !status.builtInApp && (
                <Button size="sm" disabled={!clientId || !clientSecret} onClick={() => void saveApp()} data-testid="google-save-app">
                  Save app
                </Button>
              )}
              <Button size="sm" variant="primary" disabled={!status?.configured || busy} onClick={() => void connect()} data-testid="google-connect">
                Sign in with Google
              </Button>
            </div>
          </Field>
        </>
      )}
      <Field label="Send planned training" hint="Planned sessions from 30 days ago onward. Google gets each session's name, day and description, nothing else. An event dragged to another day in Google goes back to its day in CrankHog.">
        <Switch checked={sync.enabled} disabled={!status?.connected} onChange={(v) => void patchSettings({ googleCalendar: { ...sync, enabled: v } })} label={sync.enabled ? 'On' : 'Off'} />
        {status?.connected && sync.enabled && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-dim" data-testid="google-sync-status">
            <span>
              {status.syncing
                ? 'Updating your calendar…'
                : status.lastError
                  ? status.lastError
                  : status.lastSyncAt
                    ? `Up to date: ${status.eventCount ?? 0} ${status.eventCount === 1 ? 'session' : 'sessions'}, last checked ${when(status.lastSyncAt)}.`
                    : 'Waiting for the first update.'}
            </span>
            <Button size="sm" variant="ghost" disabled={status.syncing} onClick={syncGoogleNow}>
              <RefreshCw className={status.syncing ? 'size-3.5 animate-spin' : 'size-3.5'} /> Update now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => open('https://calendar.google.com/')}>
              <ExternalLink className="size-3.5" /> Open Google Calendar
            </Button>
          </div>
        )}
      </Field>
      {msg && <div className="py-2 text-sm text-ink-dim">{msg}</div>}
    </Section>
  )
}
