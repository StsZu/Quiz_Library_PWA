// SC-02: Creator_quiz/tools/audit_page.js on the quiz screen has no fails and no warns.
import { expect, test } from '@playwright/test'
import { hasAudit, runAudit } from './helpers.ts'

const quizzes = Array.from({ length: 14 }, (_, i) => `english-through-ai-w${String(i + 1).padStart(2, '0')}`)

test.describe('quiz screen audit', () => {
  test.skip(!hasAudit, 'needs ../Creator_quiz/tools/audit_page.js')

  for (const id of quizzes) {
    test(`device viewport: ${id}`, async ({ page }, info) => {
      test.skip(info.project.name === 'chromium', 'chromium runs the fixed viewports below')
      await page.goto(`/#/quiz/${id}`)
      await expect(page.locator('#q-heading')).toBeVisible()
      const report = await runAudit(page)
      expect({ fails: report.fails, warns: report.warns }, JSON.stringify(report.viewport)).toEqual({ fails: [], warns: [] })
    })
  }

  const configs = [
    { name: '360x740 light', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, colorScheme: 'light' as const },
    { name: '1280x800 light', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, colorScheme: 'light' as const },
    { name: '1280x800 dark', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, colorScheme: 'dark' as const },
  ]
  for (const config of configs) {
    test.describe(config.name, () => {
      test.use({ viewport: config.viewport, colorScheme: config.colorScheme, hasTouch: config.hasTouch })
      for (const id of quizzes) {
        test(`${config.name}: ${id}`, async ({ page }, info) => {
          test.skip(info.project.name !== 'chromium', 'fixed viewports run in chromium')
          await page.goto(`/#/quiz/${id}`)
          await expect(page.locator('#q-heading')).toBeVisible()
          const report = await runAudit(page)
          expect({ fails: report.fails, warns: report.warns }).toEqual({ fails: [], warns: [] })
        })
      }
    })
  }
})
