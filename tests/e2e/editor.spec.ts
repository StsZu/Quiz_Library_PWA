// Spec 002, T112 (FR-80…FR-87, SC-16, SC-17): the «Створення квізу» editor on WebKit iPad.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { playSession, quizCard } from './helpers.ts'

const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, '../fixtures/quiz-package', name))
const ID = 'local-mat_689985a3039f'

const ROOT = resolve(import.meta.dirname, '../..')
const BUILD_QUIZ = resolve(ROOT, JSON.parse(readFileSync(resolve(ROOT, 'content/courses.json'), 'utf8')).source, 'tools/build_quiz.py')

/** FR-85: «Зберегти файл» on the editor screen downloads `<slug>.quiz.json` (sharing is off, as on a Mac). */
async function saveFromEditor(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save-file').click()])
  expect(download.suggestedFilename()).toBe('lekcja-6.quiz.json')
  const path = (await download.path())!
  return { path, text: readFileSync(path, 'utf8'), json: JSON.parse(readFileSync(path, 'utf8')) }
}

function buildQuiz(path: string, info: TestInfo) {
  const result = spawnSync('python3', [BUILD_QUIZ, path, '-o', info.outputPath('saved.html'), '--force'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  return { code: result.status, stderr: result.stderr }
}

async function openFile(page: Page, name: string, buffer: Buffer) {
  await page.locator('[data-testid="open-file"]').setInputFiles({ name, mimeType: 'application/json', buffer })
  await page.locator('#btn-confirm-open').click()
}

async function openEditor(page: Page) {
  await page.goto('/')
  await expect(page.locator('[data-quiz]')).toHaveCount(25)
  await openFile(page, 'lekcja-6.quiz.json', fixture('02-package-material.quiz.json'))
  await quizCard(page, ID).getByRole('link', { name: 'Створити питання' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Редагування: Lekcja 6. Edukacja')
}

interface Q { title: string; question: string; options: string[]; correct: number; feedback: string; fragment: string }

async function fillQuestion(page: Page, q: Q) {
  await page.getByLabel('Назва', { exact: true }).fill(q.title)
  await page.getByLabel('Питання', { exact: true }).fill(q.question)
  for (const [i, option] of q.options.entries()) await page.getByLabel(`Варіант ${i + 1}`, { exact: true }).fill(option)
  await page.getByLabel(`Варіант ${q.correct + 1} правильний`).check()
  await page.getByLabel('Пояснення правильної відповіді').fill(q.feedback)
  await page.locator(`[data-fragment="${q.fragment}"]`).getByRole('button', { name: 'Опора відповіді' }).click()
}

const questions: Q[] = [
  { title: 'Temat', question: 'O czym jest lekcja szósta?', options: ['O edukacji', 'O podróżach', 'O zakupach'], correct: 0, feedback: 'Lekcja mówi o edukacji.', fragment: 'f1' },
  { title: 'Zakres', question: 'Co należy do zakresu lekcji?', options: ['Pociąg', 'Internet', 'Lekarz'], correct: 1, feedback: 'Internet jest w zakresie.', fragment: 'f2' },
  { title: 'Komputer', question: 'Które słowo pojawia się w zakresie?', options: ['Rower', 'Morze', 'Komputer'], correct: 2, feedback: 'Komputer jest w zakresie.', fragment: 'f2' },
]

test('SC-16: three questions written by hand become a ready quiz; changes are saved at once', async ({ page }, info) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }) })
  await openEditor(page)
  await expect(page.locator('#editor-blockers')).toContainText('Додайте хоча б одне питання.')
  await page.locator('#btn-add-question').click()
  await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('Nowe pytanie')
  await page.getByLabel('Питання', { exact: true }).fill('Niedokończone')
  await expect(page.locator('#editor-saved')).toHaveText('Зміни збережено на пристрої як чернетку редактора: квіз ще не проходить перевірку.')

  const draft = await saveFromEditor(page)
  await expect(page.locator('#editor-notice')).toHaveText('Файл lekcja-6.quiz.json завантажено. Незавершені зміни редактора у файл не ввійшли: у ньому останній стан, що проходить перевірку.')
  expect(draft.json.questions).toEqual([])
  expect(draft.json.producer.app).toBe('quiz-library')

  await page.reload()
  await expect(page.getByLabel('Питання', { exact: true })).toHaveValue('Niedokończone')
  await page.goto('/')
  await expect(quizCard(page, ID)).toContainText('є незавершені зміни в редакторі')
  await quizCard(page, ID).getByRole('link', { name: 'Створити питання' }).click()

  await fillQuestion(page, questions[0])
  await expect(page.locator('#refs-answer_fragment_ids')).toContainText('mówienie na temat edukacji')
  for (const q of questions.slice(1)) {
    await page.locator('#btn-add-question').click()
    await fillQuestion(page, q)
  }
  await expect(page.locator('#editor-saved')).toHaveText('Зміни збережено на пристрої.')
  await expect(page.locator('#editor-counts')).toHaveText('Питань: 3 · переглянуто: 0')
  await page.locator('#btn-review-all').click()
  await expect(page.locator('#editor-notice')).toHaveText('Усі питання позначено переглянутими.')
  await expect(page.locator('#editor-ready')).toContainText('Квіз готовий і є в бібліотеці.')

  const saved = await saveFromEditor(page)
  await expect(page.locator('#editor-notice')).toHaveText('Файл lekcja-6.quiz.json завантажено.')
  const original = JSON.parse(fixture('02-package-material.quiz.json').toString())
  expect(saved.json.producer.app).toBe('quiz-library')
  expect(saved.json.source).toEqual(original.source)
  expect(saved.json.fragments).toEqual(original.fragments)
  expect(saved.json.questions.map((q: { title: string; reviewed: boolean }) => [q.title, q.reviewed])).toEqual(questions.map((q) => [q.title, true]))
  expect(buildQuiz(saved.path, info)).toEqual({ code: 0, stderr: expect.any(String) })

  await page.getByRole('link', { name: 'До бібліотеки' }).click()
  await page.locator('[data-testid="open-file"]').setInputFiles({ name: 'lekcja-6.quiz.json', mimeType: 'application/json', buffer: Buffer.from(saved.text) })
  await expect(page.locator('#open-file-message')).toContainText('Цей квіз уже додано: «Lekcja 6. Edukacja»')
  const card = quizCard(page, ID)
  await expect(card).toContainText('3 питання · Спроб: 0')
  await expect(card).not.toContainText('незавершені')
  await card.getByRole('link').first().click()
  await playSession(page, [])
  await expect(page.locator('#result-percent')).toHaveText('100%')
})

test('a question with a problem cannot be marked reviewed; revert restores the state at opening', async ({ page }) => {
  await openEditor(page)
  await page.locator('#btn-add-question').click()
  await fillQuestion(page, { ...questions[0], options: ['A. O edukacji', 'O podróżach', 'O zakupach'] })
  await expect(page.locator('#question-problems')).toContainText('приберіть літерні мітки з варіантів')
  await expect(page.locator('#btn-review')).toBeDisabled()
  await page.getByLabel('Варіант 1', { exact: true }).fill('O edukacji')
  await page.locator('#btn-review').click()
  await expect(page.locator('#question-state')).toHaveText('Переглянуто')
  await page.getByLabel('Пояснення правильної відповіді').fill('Inne wyjaśnienie.')
  await expect(page.locator('#question-state')).toHaveText('Не переглянуто')

  await page.locator('#btn-revert').click()
  await page.locator('#btn-confirm').click()
  await expect(page.locator('#editor-counts')).toHaveText('Питань: 0 · переглянуто: 0')
  await page.goto('/')
  await expect(quizCard(page, ID)).toContainText('Матеріал без питань')
})

test('SC-17: a pasted model reply adds the valid questions unreviewed and reports the broken one', async ({ page }) => {
  await openEditor(page)
  await page.locator('#btn-add-question').click()
  await fillQuestion(page, questions[0])
  await page.locator('#btn-copy-prompt').click()
  await expect(page.locator('#prompt-copied, #prompt-text')).toBeVisible()
  if (await page.locator('#prompt-text').isVisible()) await expect(page.locator('#prompt-text')).toHaveValue(/Source fragments \(JSON\)/)

  const reply = (n: number, over: object = {}) => ({
    title: `Pytanie ${n}`, question: `Co mówi zdanie ${n}?`, options: [`Prawda ${n}`, `Fałsz ${n}`, `Nie wiadomo ${n}`], correct: 0,
    feedback: `Zdanie ${n}.`, answer_fragment_ids: ['f1'], feedback_fragment_ids: ['f2'], ...over,
  })
  const text = '```json\n' + JSON.stringify({ questions: [reply(1), reply(2), reply(3, { answer_fragment_ids: ['f9'] }), reply(4), reply(5)], warning: '' }) + '\n```'
  await page.locator('#reply-text').fill(text)
  await page.locator('#btn-add-reply').click()
  await expect(page.locator('#reply-result')).toContainText('Додано питань: 4. Перевірте їх і позначте переглянутими.')
  await expect(page.locator('#reply-result')).toContainText('Питання 3 відповіді: уривків f9 немає в матеріалі')
  await expect(page.locator('#editor-counts')).toHaveText('Питань: 5 · переглянуто: 0')
  await page.getByRole('button', { name: /^Питання 1: Temat/ }).click()
  await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('Temat')
  await expect(page.getByLabel('Питання', { exact: true })).toHaveValue(questions[0].question)
})

test('editing a ready quiz from disk takes it back to a draft until reviewed again', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-quiz]')).toHaveCount(25)
  await openFile(page, 'lekcja-6.quiz.json', fixture('01-package-ready.quiz.json'))
  await quizCard(page, ID).getByRole('link', { name: 'Редагувати' }).click()
  await expect(page.locator('#editor-ready')).toBeVisible()
  await page.getByLabel('Пояснення правильної відповіді').fill('Lekcja dotyczy edukacji i wykształcenia.')
  await expect(page.locator('#editor-blockers')).toContainText('1. питання не переглянуто')
  await page.goto('/')
  const card = quizCard(page, ID)
  await expect(card).toContainText('Чернетка · переглянуто 1 з 2')
  await card.getByRole('link', { name: 'Редагувати' }).click()
  await page.locator('#btn-review').click()
  await expect(page.locator('#editor-ready')).toBeVisible()
})
