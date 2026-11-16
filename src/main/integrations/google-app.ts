// CrankHog's own Google app, when the build carries one. electron.vite.config
// fills this in from CRANKHOG_GOOGLE_CLIENT_ID / CRANKHOG_GOOGLE_CLIENT_SECRET
// at build time (a CI secret, never committed). A desktop app's client secret
// can't be kept from someone who unpacks the app, and Google's installed-app
// flow allows for that: PKCE and the loopback redirect protect the sign-in.
import type { GoogleAppCredentials } from './google'

declare const __CRANKHOG_GOOGLE_APP__: GoogleAppCredentials | null | undefined

export function builtInGoogleApp(): GoogleAppCredentials | null {
  const app = typeof __CRANKHOG_GOOGLE_APP__ === 'undefined' ? null : __CRANKHOG_GOOGLE_APP__
  return app?.clientId && app.clientSecret ? app : null
}
