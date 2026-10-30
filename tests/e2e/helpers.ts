import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'

export const auditPath = resolve(import.meta.dirname, '../../../Creator_quiz/tools/audit_page.js')
export const hasAudit = existsSync(auditPath)

interface QuizQuestion { correct: number; options: string[] }

export async function questions(page: Page): Promise<QuizQuestion[]> {
  return JSON.parse((await page.locator('#quiz-data').textContent()) ?? '[]') as QuizQuestion[]
}

/** Answers the current session; `wrong` lists 1-based question numbers to answer wrong. */
export async function playSession(page: Page, wrong: number[] = []) {
  const qs = await questions(page)
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i]
    const choice = wrong.includes(i + 1) ? (q.correct + 1) % q.options.length : q.correct
    await page.locator('#options .option').nth(choice).click()
    await page.locator('#btn-next').click()
  }
  await expect(page.locator('#result')).toBeVisible()
}

export async function runAudit(page: Page) {
  page.on('dialog', (dialog) => dialog.accept())
  const report = await page.evaluate(readFileSync(auditPath, 'utf8'))
  return report as { ok: boolean; fails: unknown[]; warns: unknown[]; viewport: unknown }
}

export function quizCard(page: Page, id: string) {
  return page.locator(`[data-quiz="${id}"]`)
}
