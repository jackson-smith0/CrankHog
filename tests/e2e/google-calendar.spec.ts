import { expect, test } from '@playwright/test'
import { launchApp, type Launched } from './launch'

// Google Calendar in Settings: signed out, the sync stays off and main
// ignores calendar snapshots. Signing in itself needs a real Google account.
let ctx: Launched

test.beforeAll(async () => {
  ctx = await launchApp()
})
test.afterAll(async () => {
  await ctx?.close()
})

test('Settings: Google Calendar starts signed out, takes the rider’s own app, and main sends nothing until sign-in', async () => {
  const { page } = ctx
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: /Strava/ }).click()
  await expect(page.getByText('Google Calendar', { exact: true })).toBeVisible()
  const signIn = page.getByTestId('google-connect')
  await expect(signIn).toBeVisible()

  const status = await page.evaluate(() => window.crankhog.invoke('google.status', {}))
  expect(status).toMatchObject({ connected: false, syncing: false })
  if (!status.builtInApp) {
    // no app in this build: the rider pastes their own Desktop OAuth client
    await expect(signIn).toBeDisabled()
    await page.getByLabel('Google client ID').fill('123456789012-abcdefghijklmnop1234.apps.googleusercontent.com')
    await page.getByLabel('Google client secret').fill('GOCSPX-fake-xxxxxxxxxxxxxxxx')
    await page.getByTestId('google-save-app').click()
    await expect(page.getByText('Google app saved. Now sign in.')).toBeVisible()
  }
  await expect(signIn).toBeEnabled()
  await page.getByText('Google Calendar', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('google-calendar-settings.png') })

  // the token never reaches the renderer, and a snapshot while signed out goes nowhere
  const after = await page.evaluate(() => window.crankhog.invoke('google.status', {}))
  expect(JSON.stringify(after)).not.toMatch(/GOCSPX|token/i)
  const sent = await page.evaluate(() => window.crankhog.invoke('google.calendar.sync', { windowStart: '2026-10-17', events: [{ key: 's1', date: '2026-11-18', title: 'Sweet spot', description: '' }] }))
  expect(sent).toEqual({ ok: false })
})
