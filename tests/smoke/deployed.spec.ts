import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { hasAudit, playSession, quizCard, runAudit } from '../e2e/helpers.ts'

function watch(page: Page, context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin
  const foreign: string[] = []
  const errors: string[] = []
  context.on('request', (r) => { if (new URL(r.url()).origin !== origin) foreign.push(r.url()) })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  return { foreign, errors }
}

async function waitForServiceWorker(page: Page) {
  return page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }))
    return !!navigator.serviceWorker.controller
  })
}

test('the deployed app loads with headers, a service worker and a clean quiz audit', async ({ page, context, baseURL }) => {
  test.skip(!baseURL, 'set SMOKE_URL')
  const seen = watch(page, context, baseURL!)
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")
  await expect(page.locator('[data-quiz]')).toHaveCount(11)
  expect(await waitForServiceWorker(page)).toBe(true)
  if (hasAudit) {
    await page.goto('/#/quiz/chysta-chastota-ep10')
    await expect(page.locator('#q-heading')).toBeVisible()
    const report = await runAudit(page)
    expect({ fails: report.fails, warns: report.warns }).toEqual({ fails: [], warns: [] })
  }
  await page.goto('/#/settings')
  await expect(page.locator('#app-version')).toContainText('Версія')
  expect(seen.foreign).toEqual([])
  expect(seen.errors).toEqual([])
})

test('the deployed app works offline after the first load', async ({ page, context, baseURL }) => {
  test.skip(!baseURL, 'set SMOKE_URL')
  const seen = watch(page, context, baseURL!)
  await page.goto('/')
  await expect(page.locator('[data-quiz]')).toHaveCount(11)
  expect(await waitForServiceWorker(page)).toBe(true)
  await context.setOffline(true)
  await page.goto('/#/quiz/chysta-chastota-ep08')
  await page.reload()
  await playSession(page, [])
  await expect(page.locator('#result-percent')).toHaveText('100%')
  await page.goto('/')
  await expect(quizCard(page, 'chysta-chastota-ep08')).toContainText('Останній результат: 10 з 10')
  expect(seen.foreign).toEqual([])
  expect(seen.errors).toEqual([])
})
