import { BrowserWindow, shell } from 'electron'
import { builtInGoogleApp } from '../integrations/google-app'
import { GoogleClient } from '../integrations/google'
import { GoogleCalendarSync } from '../integrations/google-calendar-sync'
import type { SecretStore } from '../secrets/secret-store'
import { emit, handle } from './register'

/** Google sign-in and the CrankHog calendar mirrored there. Tokens never leave main. */
export function registerGoogleHandlers(deps: {
  secrets: SecretStore
  /** Whether the rider has the calendar sync switched on (settings are main's). */
  syncEnabled: () => boolean
  /** A new sign-in: the sync switches on (the rider can turn it off). */
  onConnected?: () => void
}): GoogleCalendarSync {
  const google = new GoogleClient(deps.secrets, builtInGoogleApp())
  const sync = new GoogleCalendarSync(google, (status) => {
    for (const w of BrowserWindow.getAllWindows()) emit(w.webContents, 'google.calendar.changed', status)
  })

  handle('google.status', () => sync.status())
  handle('google.setApp', ({ clientId, clientSecret }) => {
    google.setApp({ clientId, clientSecret })
    sync.reset()
    return { ok: true }
  })
  handle('google.connect', async () => {
    try {
      const t = await google.connect(async (url) => {
        await shell.openExternal(url)
      })
      deps.onConnected?.()
      sync.reset()
      return { ok: true, ...(t.email ? { email: t.email } : {}) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  handle('google.disconnect', async () => {
    await google.disconnect()
    sync.reset()
    return { ok: true }
  })
  handle('google.calendar.sync', ({ windowStart, events }) => {
    if (!deps.syncEnabled() || !google.connected()) return { ok: false }
    void sync.request({ windowStart, events })
    return { ok: true }
  })
  return sync
}
