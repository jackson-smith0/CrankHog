import { describe, expect, it } from 'vitest'
import { bundleCarries, resolveGoogleApp } from '../../scripts/google-app.mjs'

// Placeholders only: the secret scanner treats "fake" and "xxxxxx" as obvious stand-ins.
const ID = '123456789012-fakeclientidxxxxxx.apps.googleusercontent.com'
const SECRET = 'GOCSPX-fake-xxxxxxxxxxxxxxxx'
const keychain =
  (items: Partial<Record<'client-id' | 'client-secret', string>>) =>
  (account: 'client-id' | 'client-secret') =>
    items[account] ?? null

describe('the Google app for the signed release', () => {
  it('takes the environment over the keychain', () => {
    const r = resolveGoogleApp({ CRANKHOG_GOOGLE_CLIENT_ID: ID, CRANKHOG_GOOGLE_CLIENT_SECRET: SECRET }, keychain({ 'client-id': 'other' }))
    expect(r).toEqual({ ok: true, source: 'environment', app: { clientId: ID, clientSecret: SECRET } })
  })

  it('reads the keychain when the environment has none, or only half', () => {
    const items = keychain({ 'client-id': `${ID}\n`, 'client-secret': SECRET })
    expect(resolveGoogleApp({}, items)).toEqual({ ok: true, source: 'keychain', app: { clientId: ID, clientSecret: SECRET } })
    expect(resolveGoogleApp({ CRANKHOG_GOOGLE_CLIENT_ID: ID }, items)).toMatchObject({ ok: true, source: 'keychain' })
  })

  it('says what is missing, so the release stops', () => {
    expect(resolveGoogleApp({}, keychain({}))).toEqual({ ok: false, error: 'The client ID and client secret are missing from the keychain.' })
    expect(resolveGoogleApp({}, keychain({ 'client-id': ID }))).toEqual({ ok: false, error: 'The client secret is missing from the keychain.' })
  })

  it('catches a client ID pasted wrong', () => {
    const r = resolveGoogleApp({ CRANKHOG_GOOGLE_CLIENT_ID: 'GOCSPX-oops', CRANKHOG_GOOGLE_CLIENT_SECRET: SECRET }, keychain({}))
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't look like a Google client ID/) })
  })

  it('checks the built bundle really carries the app', () => {
    expect(bundleCarries(`const app = {"clientId":"${ID}"}`, ID)).toBe(true)
    expect(bundleCarries('const app = null', ID)).toBe(false)
    expect(bundleCarries('anything', '')).toBe(false)
  })
})
