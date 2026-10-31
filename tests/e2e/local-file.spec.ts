// Spec 002, T108 (FR-60, FR-62, FR-64, FR-65, SC-14): opening quiz files from disk in the library.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { playSession, quizCard } from './helpers.ts'

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
  await expect(card.getByRole('link')).toHaveCount(0)
})
