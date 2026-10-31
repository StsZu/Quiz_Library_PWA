// SC-05: after the first load the library and a quiz never opened before work without network;
// no request leaves the origin.
import { expect, test } from '@playwright/test'
import { playSession, quizCard } from './helpers.ts'

test('works offline after the first load', async ({ page, context, baseURL }) => {
  const foreign: string[] = []
  context.on('request', (request) => {
    if (!request.url().startsWith(baseURL!)) foreign.push(request.url())
  })
  await page.goto('/')
  await expect(page.locator('[data-quiz]')).toHaveCount(25)
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
    return registration.active?.state
  })
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('[data-quiz]')).toHaveCount(25)
  // Spec 002, T119: favicon and the iOS icon come from the cache too.
  const icons = await page.evaluate(() => Promise.all(['favicon.svg', 'favicon.ico', 'icons/icon-180.png'].map(async (path) => {
    const response = await fetch(path)
    return `${path} ${response.status} ${response.headers.get('content-type')}`
  })))
  expect(icons).toEqual([
    expect.stringMatching(/^favicon\.svg 200 image\/svg\+xml/),
    expect.stringMatching(/^favicon\.ico 200 /),
    expect.stringMatching(/^icons\/icon-180\.png 200 image\/png/),
  ])
  await page.goto('/#/quiz/chysta-chastota-ep09')
  await page.reload()
  await playSession(page, [3])
  await expect(page.locator('#result-percent')).toHaveText('90%')
  await page.locator('#result').getByRole('link', { name: 'До бібліотеки' }).click()
  await expect(quizCard(page, 'chysta-chastota-ep09')).toContainText('Останній результат: 9 з 10')
  expect(foreign).toEqual([])
})
