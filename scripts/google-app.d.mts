export const KEYCHAIN_SERVICE: 'crankhog-google'

export interface GoogleApp {
  clientId: string
  clientSecret: string
}

export type GoogleAppResult = { ok: true; source: 'environment' | 'keychain'; app: GoogleApp } | { ok: false; error: string }

export function resolveGoogleApp(env: Record<string, string | undefined>, readKeychain: (account: 'client-id' | 'client-secret') => string | null): GoogleAppResult

export function bundleCarries(mainJs: string, clientId: string): boolean
