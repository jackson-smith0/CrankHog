import { expect, test } from '@playwright/test'
import { launchApp, type Launched } from './launch'

let ctx: Launched
test.beforeAll(async () => {
  ctx = await launchApp()
})
test.afterAll(async () => {
  await ctx?.close()
})

const pad = (n: number) => String(n).padStart(2, '0')
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

test('a squash game logged by hand counts under Other, and planned run and swim files land on their days', async () => {
  const { page } = ctx
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Calendar', exact: true }).click()
  const cal = page.getByTestId('ride-calendar')
  await expect(cal).toBeVisible()

  // log an hour of hard squash today
  const today = key(new Date())
  await cal.locator(`[data-date="${today}"] [data-testid="calendar-day-menu"]`).click()
  await page.getByRole('radio', { name: 'Log an activity' }).click()
  await page.getByRole('radio', { name: 'Other' }).click()
  await page.getByTestId('log-label').fill('Squash')
  await page.getByTestId('log-time').fill('1:00')
  await page.getByRole('radio', { name: 'Hard' }).click()
  await page.getByTestId('day-log-add').click()
  await expect(cal.locator(`[data-date="${today}"] [data-testid="calendar-activity"][data-sport="other"]`)).toContainText('Squash')
  await expect(cal.getByTestId('week-volume').locator('[data-sport="other"]').first()).toContainText('1h 00m')

  // import a planned run and a swim for later this week, and one with no date
  const later = new Date()
  later.setDate(later.getDate() + 1)
  const later2 = new Date()
  later2.setDate(later2.getDate() + 2)
  await page.setInputFiles('[data-testid="sessions-file"]', [
    { name: `${key(later)}_Threshold 4x8.txt`, mimeType: 'text/plain', buffer: Buffer.from('sport: run\nname: Threshold 4x8\n\nWarmup\n- 15m Z2 HR\n\nMain set 4x\n- 8m 4:10-4:20/km Pace\n- 2m Z1 HR\n') },
    { name: `${key(later2)}_CSS 10x100.txt`, mimeType: 'text/plain', buffer: Buffer.from('sport: swim\nname: CSS 10x100\npool: 25m\n\nMain set 10x\n- 100mtr 1:40/100m Pace\n- 15s rest\n') },
    { name: 'Easy 8k.txt', mimeType: 'text/plain', buffer: Buffer.from('sport: run\nname: Easy 8k\ndistance: 8km\neffort: easy\n') },
  ])
  const report = page.getByTestId('import-report')
  await expect(report).toContainText('2 on the calendar, 1 skipped.')
  await expect(report.locator('[data-outcome="skipped"]')).toContainText('No date')
  await expect(page.locator(`[data-testid="calendar-planned"][data-sport="run"]`).first()).toContainText('Threshold 4x8')
  await expect(page.locator(`[data-testid="calendar-planned"][data-sport="swim"]`).first()).toContainText('CSS 10x100')

  // a planned run can't be ridden
  await page.locator(`[data-testid="calendar-planned"][data-sport="run"]`).first().click()
  await expect(page.getByTestId('planned-session-details')).toContainText('Run')
  await expect(page.getByTestId('planned-ride')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // the format guide opens from the calendar
  await page.getByTestId('format-guide-link').first().click()
  await expect(page.getByTestId('format-guide')).toContainText('m always means minutes')
  await page.keyboard.press('Escape')
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
})
