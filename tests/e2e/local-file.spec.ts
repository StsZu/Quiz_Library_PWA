// Spec 002, T108 (FR-60, FR-62, FR-64, FR-65, SC-14): opening quiz files from disk in the library.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { hasAudit, playSession, questions, quizCard, runAudit } from './helpers.ts'

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, '../fixtures/quiz-package', name))
const LESSON = 'local-mat_689985a3039f'

async function open(page: Page, name: string, buffer: Buffer) {
  await page.locator('[data-testid="open-file"]').setInputFiles({ name, mimeType: 'application/json', buffer })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-quiz]')).toHaveCount(25)
})

test('a quiz file from disk is added, played and kept after a reload', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Відкрити файл квізу' })).toBeVisible()
  await open(page, 'lekcja-6.quiz.json', fixture('01-package-ready.quiz.json'))
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Додати квіз?')
  await expect(dialog).toContainText('Lekcja 6. Edukacja')
  await expect(dialog).toContainText('Polski — lekcje')
  await expect(dialog).toContainText('Питань: 2')
  await page.locator('#btn-confirm-open').click()
  await expect(page.locator('#open-file-message')).toContainText('Квіз «Lekcja 6. Edukacja» додано.')
  await expect(page.getByRole('heading', { name: 'Polski — lekcje' })).toBeVisible()
  const card = quizCard(page, LESSON)
  await expect(card).toContainText('2 питання · Спроб: 0')

  await page.locator('#open-file-message').getByRole('link', { name: 'Почати квіз' }).click()
  await expect(page.locator('#q-heading')).toBeVisible()
  await playSession(page, [2])
  await expect(page.locator('#result-percent')).toHaveText('50%')
  await page.locator('#result').getByRole('link', { name: 'До бібліотеки' }).click()
  await expect(card).toContainText('Останній результат: 1 з 2')
  await expect(card.getByRole('link', { name: 'Повторити помилки (1)' })).toBeVisible()
  await expect(page.locator('#open-file-message')).toHaveCount(0)
  await page.reload()
  await expect(card).toContainText('Спроб: 1 · Останній результат: 1 з 2')
  await expect(page.locator('[data-quiz]')).toHaveCount(26)
})

test('an invalid file shows its problems and changes nothing', async ({ page }) => {
  await open(page, 'broken.json', fixture('06-bad-correct-out-of-range.json'))
  const alert = page.locator('#open-file-problems')
  await expect(alert).toContainText('Файл «broken.json» не відкрито. Дані не змінено.')
  await expect(alert).toContainText('«correct» = 3, а має бути від 0 до 2')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('[data-quiz]')).toHaveCount(25)
  await open(page, 'not-json.json', Buffer.from('{"meta": '))
  await expect(alert).toContainText('Файл не є JSON')
})

test('the same file is «already added»; a changed one offers an update with counts', async ({ page }) => {
  await open(page, 'lekcja-6.quiz.json', fixture('01-package-ready.quiz.json'))
  await page.locator('#btn-confirm-open').click()
  await expect(page.locator('#open-file-message')).toContainText('додано')
  await open(page, 'copy.quiz.json', fixture('01-package-ready.quiz.json'))
  await expect(page.locator('#open-file-message')).toHaveText('Цей квіз уже додано: «Lekcja 6. Edukacja». Нічого не змінено.')

  const changed = JSON.parse(fixture('01-package-ready.quiz.json').toString())
  changed.questions[1].question = 'Które słowo pasuje do lekcji?'
  await open(page, 'lekcja-6-v2.quiz.json', Buffer.from(JSON.stringify(changed)))
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Оновити квіз?')
  await expect(page.locator('#open-diff')).toHaveText('Нових питань: 0 · змінених: 1 · вилучених: 0 · без змін: 1. Спроби лишаються в історії.')
  await dialog.getByRole('button', { name: 'Оновити' }).click()
  await expect(page.locator('#open-file-message')).toContainText('Квіз «Lekcja 6. Edukacja» оновлено.')
  await expect(page.locator('[data-quiz]')).toHaveCount(26)
})

test('cancel stores nothing; warnings, a built-in copy and a material are shown', async ({ page }) => {
  await open(page, 'labels.json', fixture('20-warn-letter-labels.json'))
  await expect(page.locator('#open-warnings')).toContainText('літерної мітки')
  await page.getByRole('dialog').getByRole('button', { name: 'Скасувати' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.reload()
  await expect(page.locator('[data-quiz]')).toHaveCount(25)

  await open(page, 'chysta-chastota-ep01.json', fixture('04-creator-wrapper.json'))
  await expect(page.locator('#open-copy')).toHaveText('Цей квіз уже є в курсі «Чиста частота». Буде додано окрему копію з диска.')
  await page.locator('#btn-confirm-open').click()
  await expect(page.getByRole('heading', { name: 'Мої файли' })).toBeVisible()
  await expect(quizCard(page, 'local-chysta-chastota-ep01')).toBeVisible()

  const material = JSON.parse(fixture('02-package-material.quiz.json').toString())
  material.source.material_id = 'mat_material'
  await open(page, 'material.quiz.json', Buffer.from(JSON.stringify(material)))
  await expect(page.getByRole('dialog')).toContainText('Матеріал без питань')
  await page.locator('#btn-confirm-open').click()
  const card = quizCard(page, 'local-mat_material')
  await expect(card).toContainText('Матеріал без питань')
  await expect(page.locator('#open-file-message').getByRole('link')).toHaveCount(0)
  await expect(card.locator('a.quiz-open')).toHaveCount(0)
  await expect(card.getByRole('link', { name: 'Створити питання' })).toBeVisible()
})

// Spec 002, T109 (FR-70…FR-73, SC-14): state, actions and isolation of errors in the library.
const five = (changeLast = false) => Buffer.from(JSON.stringify({
  meta: { title: 'Five questions', lang: 'en' },
  questions: [1, 2, 3, 4, 5].map((n) => ({
    title: `Q${n}`, question: `Question ${n}?`, options: changeLast && n === 5 ? ['A5', 'B5', 'Other'] : [`A${n}`, `B${n}`, `C${n}`],
    correct: n % 3, feedback: `Because ${n}.`,
  })),
}))

test('SC-14: mistakes survive a reload and an update keeps the one on an unchanged question', async ({ page }) => {
  await open(page, 'five.json', five())
  await page.locator('#btn-confirm-open').click()
  await page.locator('#open-file-message').getByRole('link', { name: 'Почати квіз' }).click()
  await playSession(page, [2, 5])
  await expect(page.locator('#result-percent')).toHaveText('60%')
  await page.locator('#result').getByRole('link', { name: 'До бібліотеки' }).click()
  await page.reload()
  const card = quizCard(page, 'local-five')
  await expect(card.getByRole('link', { name: 'Повторити помилки (2)' })).toBeVisible()

  await open(page, 'five.json', five(true))
  await expect(page.locator('#open-diff')).toHaveText('Нових питань: 0 · змінених: 1 · вилучених: 0 · без змін: 4. Спроби лишаються в історії.')
  await page.locator('#btn-confirm-open').click()
  await card.getByRole('link', { name: 'Повторити помилки (1)' }).click()
  const shown = await questions(page)
  expect(shown).toHaveLength(1)
  await expect(page.locator('#q-heading')).toContainText('Question 2?')
})

test('a quiz from disk is labelled, saved to a file and deleted with its statistics kept', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }) })
  await page.reload()
  await open(page, 'lekcja-6.quiz.json', fixture('01-package-ready.quiz.json'))
  await page.locator('#btn-confirm-open').click()
  const card = quizCard(page, LESSON)
  await expect(card.locator('.chip-file')).toHaveText('З файлу')
  await expect(quizCard(page, 'chysta-chastota-ep01').locator('.chip-file')).toHaveCount(0)

  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Зберегти файл' }).click()])
  expect(download.suggestedFilename()).toBe('lekcja-6.quiz.json')
  const saved = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(saved.producer.app).toBe('quiz-library')
  expect(saved.questions).toEqual(JSON.parse(fixture('01-package-ready.quiz.json').toString()).questions)
  await open(page, 'lekcja-6.quiz.json', Buffer.from(JSON.stringify(saved)))
  await expect(page.locator('#open-file-message')).toContainText('Цей квіз уже додано')

  await card.getByRole('link').first().click()
  await playSession(page, [])
  await page.locator('#result').getByRole('link', { name: 'До бібліотеки' }).click()
  await card.getByRole('button', { name: 'Видалити' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Видалити «Lekcja 6. Edukacja»?')
  await page.locator('#btn-confirm-delete').click()
  await expect(card).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Polski — lekcje' })).toHaveCount(0)
  await open(page, 'lekcja-6.quiz.json', fixture('01-package-ready.quiz.json'))
  await page.locator('#btn-confirm-open').click()
  await expect(card).toContainText('Спроб: 1 · Останній результат: 2 з 2')
})

test('a draft is shown with its review state and cannot be played yet', async ({ page }) => {
  const draft = JSON.parse(fixture('03-package-draft.quiz.json').toString())
  draft.source.material_id = 'mat_draft'
  await open(page, 'draft.quiz.json', Buffer.from(JSON.stringify(draft)))
  await expect(page.getByRole('dialog')).toContainText('Чернетка: переглянуто 1 з 2 питань')
  await page.locator('#btn-confirm-open').click()
  const card = quizCard(page, 'local-mat_draft')
  await expect(card).toContainText('Чернетка · переглянуто 1 з 2')
  await expect(card.locator('a.quiz-open')).toHaveCount(0)
  await expect(card.getByRole('link', { name: 'Редагувати' })).toBeVisible()
  await page.goto('/#/quiz/local-mat_draft')
  await expect(page.getByText('Це чернетка: не всі питання переглянуто.')).toBeVisible()
})

test('FR-72: a built-in quiz that fails to load does not break the library', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.route('**/content/chysta-chastota-ep03.json', (route) => route.fulfill({ status: 404, body: 'missing' }))
  await page.goto('/')
  const broken = quizCard(page, 'chysta-chastota-ep03')
  await expect(broken).toContainText('Не вдалося відкрити: Не вдалося завантажити chysta-chastota-ep03.json: 404')
  await expect(broken.getByRole('link')).toHaveCount(0)
  await expect(page.locator('[data-quiz] a.quiz-open')).toHaveCount(24)
  await quizCard(page, 'chysta-chastota-ep04').getByRole('link').click()
  await expect(page.locator('#q-heading')).toBeVisible()
  await context.close()
})

test('the quiz screen of a quiz from disk passes audit_page.js', async ({ page }) => {
  test.skip(!hasAudit, 'needs ../Creator_quiz/tools/audit_page.js')
  await open(page, 'lekcja-6.quiz.json', fixture('01-package-ready.quiz.json'))
  await page.locator('#btn-confirm-open').click()
  await page.goto(`/#/quiz/${LESSON}`)
  await expect(page.locator('#q-heading')).toBeVisible()
  const report = await runAudit(page)
  expect({ fails: report.fails, warns: report.warns }).toEqual({ fails: [], warns: [] })
})

test('SC-18: a quiz from disk and its attempts move to an empty device through the progress file', async ({ page, browser, baseURL }) => {
  await open(page, 'lekcja-6.quiz.json', fixture('01-package-ready.quiz.json'))
  await page.locator('#btn-confirm-open').click()
  await quizCard(page, LESSON).getByRole('link').first().click()
  await playSession(page, [2])
  await page.goto('/#/settings')
  await expect(page.locator(`[data-local-quiz="${LESSON}"]`)).toHaveText('Lekcja 6. Edukacja (з файлу)10')
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export').click()])
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect([exported.schemaVersion, exported.data.userQuizzes.map((q: { id: string }) => q.id)]).toEqual([2, [LESSON]])

  const context = await browser.newContext({ baseURL })
  const fresh = await context.newPage()
  await fresh.goto('/#/settings')
  await fresh.locator('[data-testid="import-file"]').setInputFiles((await download.path())!)
  await expect(fresh.locator('#import-dialog-quizzes')).toHaveText('Квізи з диска: додати 1, оновити 0, лишити без змін 0. Жоден квіз не буде видалено.')
  await fresh.locator('#btn-confirm-import').click()
  await expect(fresh.getByRole('status')).toContainText('Прогрес замінено: спроб 1. Квізи з диска: додано 1, оновлено 0.')
  await fresh.goto('/')
  const card = quizCard(fresh, LESSON)
  await expect(card).toContainText('Спроб: 1 · Останній результат: 1 з 2')
  await expect(card.getByRole('link', { name: 'Повторити помилки (1)' })).toBeVisible()
  await context.close()
})
