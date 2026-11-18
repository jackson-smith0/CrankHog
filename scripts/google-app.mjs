// CrankHog's Google app (the Desktop OAuth client riders sign in to Google
// Calendar with) for the signed release build. scripts/dist-signed.mjs builds
// the DMG riders actually download, so it must carry the app: without it,
// every rider is sent off to make their own Google Cloud project.
//
// Stored once per Mac in the login keychain, like the notary profile:
//   security add-generic-password -U -s crankhog-google -a client-id -w
//   security add-generic-password -U -s crankhog-google -a client-secret -w
// CRANKHOG_GOOGLE_CLIENT_ID and CRANKHOG_GOOGLE_CLIENT_SECRET override it.

export const KEYCHAIN_SERVICE = 'crankhog-google'

const CLIENT_ID = /^[0-9]{1,30}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/

/**
 * The Google app for the build: from the environment when both variables are
 * set, else from the keychain. `readKeychain(account)` returns the stored
 * value or null.
 */
export function resolveGoogleApp(env, readKeychain) {
  const fromEnv = env.CRANKHOG_GOOGLE_CLIENT_ID?.trim() && env.CRANKHOG_GOOGLE_CLIENT_SECRET?.trim()
  const source = fromEnv ? 'environment' : 'keychain'
  const clientId = (fromEnv ? env.CRANKHOG_GOOGLE_CLIENT_ID : readKeychain('client-id'))?.trim() ?? ''
  const clientSecret = (fromEnv ? env.CRANKHOG_GOOGLE_CLIENT_SECRET : readKeychain('client-secret'))?.trim() ?? ''
  const missing = [!clientId && 'client ID', !clientSecret && 'client secret'].filter(Boolean)
  if (missing.length > 0) return { ok: false, error: `The ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing from the ${source}.` }
  if (!CLIENT_ID.test(clientId)) return { ok: false, error: `The client ID in the ${source} doesn't look like a Google client ID (…apps.googleusercontent.com).` }
  return { ok: true, source, app: { clientId, clientSecret } }
}

/** Whether the built main process carries the client ID, i.e. the app really went in. */
export function bundleCarries(mainJs, clientId) {
  return clientId.length > 0 && mainJs.includes(clientId)
}
