import { expect, test } from '@playwright/test'
import { playSession, questions, quizCard } from './helpers.ts'

test('the library lists the courses', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Мої квізи')
  await expect(page.getByRole('heading', { name: 'Чиста частота' })).toBeVisible()
  await expect(page.locator('[data-quiz]')).toHaveCount(25)
  await expect(quizCard(page, 'chysta-chastota-ep01')).toContainText('10 питань · Спроб: 0')
})

test('an attempt and its mistakes survive a reload and a new context (SC-03)', async ({ page, browser }) => {
  await page.goto('/#/quiz/chysta-chastota-ep02')
  await playSession(page, [2, 5])
  await expect(page.locator('#result-percent')).toHaveText('80%')
  await expect(page.getByRole('link', { name: 'Повторити помилки (2)' })).toBeVisible()
  await page.locator('#result').getByRole('link', { name: 'До бібліотеки' }).click()
  const card = quizCard(page, 'chysta-chastota-ep02')
  await expect(card).toContainText('Спроб: 1 · Останній результат: 8 з 10')
  await expect(card.getByRole('link', { name: 'Повторити помилки (2)' })).toBeVisible()
  await page.reload()
  await expect(card).toContainText('Спроб: 1')
  const state = await page.context().storageState({ indexedDB: true })
  const context = await browser.newContext({ storageState: state })
  const fresh = await context.newPage()
  await fresh.goto('/')
  await expect(quizCard(fresh, 'chysta-chastota-ep02')).toContainText('Останній результат: 8 з 10')
  await context.close()
})

test('mistakes mode shows exactly the wrong questions (SC-04)', async ({ page }) => {
  await page.goto('/#/quiz/chysta-chastota-ep03')
  const all = await questions(page)
  await playSession(page, [2, 5])
  await page.getByRole('link', { name: 'Повторити помилки (2)' }).click()
  await expect(page.locator('#chip-counter')).toHaveText('Питання 1 з 2')
  const shown = await questions(page)
  expect(shown.map((q) => q.options[0])).toEqual([all[1].options[0], all[4].options[0]])
  await page.locator('#options .option').nth(shown[0].correct).click()
  await page.locator('#btn-next').click()
  await page.locator('#options .option').nth((shown[1].correct + 1) % 3).click()
  await page.locator('#btn-next').click()
  await expect(page.locator('#result-summary')).toHaveText('Правильних відповідей: 1 з 2')
  await page.locator('#result').getByRole('link', { name: 'До бібліотеки' }).click()
  await expect(quizCard(page, 'chysta-chastota-ep03').getByRole('link', { name: 'Повторити помилки (1)' })).toBeVisible()
})

test('an unfinished attempt resumes after a reload (FR-31)', async ({ page }) => {
  await page.goto('/#/quiz/chysta-chastota-ep04')
  const qs = await questions(page)
  for (let i = 0; i < 3; i++) {
    await page.locator('#options .option').nth(qs[i].correct).click()
    await page.locator('#btn-next').click()
  }
  await page.reload()
  await expect(page.locator('#chip-counter')).toHaveText('Питання 4 з 10')
  await expect(page.locator('#chip-score')).toHaveText('Бали: 3')
})

test('restart during a quiz asks for confirmation (FR-22)', async ({ page }) => {
  await page.goto('/#/quiz/chysta-chastota-ep05')
  const qs = await questions(page)
  await page.locator('#options .option').nth(qs[0].correct).click()
  await page.locator('#btn-next').click()
  page.once('dialog', (d) => d.dismiss())
  await page.locator('#btn-restart-during').click()
  await expect(page.locator('#chip-counter')).toHaveText('Питання 2 з 10')
  page.once('dialog', (d) => d.accept())
  await page.locator('#btn-restart-during').click()
  await expect(page.locator('#chip-counter')).toHaveText('Питання 1 з 10')
  await expect(page.locator('#chip-score')).toHaveText('Бали: 0')
})

test('keyboard: digits and Enter complete a quiz (spec 001 AC-22)', async ({ page }, info) => {
  test.skip(info.project.name !== 'webkit-ipad', 'keyboard runs once')
  await page.goto('/#/quiz/chysta-chastota-ep06')
  const qs = await questions(page)
  for (const q of qs) {
    await page.keyboard.press(String(q.correct + 1))
    await expect(page.locator('#btn-next')).toBeFocused()
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('#result-percent')).toHaveText('100%')
})

test('export, then import of the same file restores the attempts (SC-06)', async ({ page }, info) => {
  test.skip(info.project.name !== 'webkit-ipad', 'export runs once')
  await page.goto('/#/quiz/chysta-chastota-ep07')
  await playSession(page, [1])
  await page.goto('/#/settings')
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export').click()])
  const path = await download.path()
  await page.locator('[data-testid="import-file"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') })
  await expect(page.getByRole('alert')).toContainText('Файл не є JSON')
  await page.locator('[data-testid="import-file"]').setInputFiles(path)
  await expect(page.getByRole('dialog')).toContainText('Файл містить спроб: 1')
  await page.locator('#btn-confirm-import').click()
  await expect(page.getByRole('status')).toContainText('Прогрес замінено: спроб 1.')
  await page.goto('/')
  await expect(quizCard(page, 'chysta-chastota-ep07')).toContainText('Останній результат: 9 з 10')
})
