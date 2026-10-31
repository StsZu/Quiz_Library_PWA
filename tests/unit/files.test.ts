// Spec 002, FR-85: file name and producer of a saved quiz from disk; share on touch devices, download elsewhere.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserQuiz } from '../../src/contracts.ts'
import { packageFileName, packageForSave, saveFile } from '../../src/app/files.ts'

const quiz = { fileName: 'Lekcja 6.quiz.json', package: { format: 'quiz-package', format_version: 1, meta: { title: 'T', lang: 'pl', dir: 'ltr', description: '' }, questions: [], producer: { app: 'converter-pwa-youtube' } } } as unknown as UserQuiz

afterEach(() => vi.restoreAllMocks())

describe('saving a quiz file', () => {
  it('names the file by its slug and marks this app as the producer', () => {
    expect(packageFileName(quiz)).toBe('lekcja-6.quiz.json')
    const pkg = packageForSave(quiz, '31.10.2026 · abc', new Date('2026-10-31T10:00:00Z'))
    expect(pkg.producer).toEqual({ app: 'quiz-library', version: '31.10.2026 · abc', created_at: '2026-10-31T10:00:00.000Z' })
    expect(quiz.package.producer).toEqual({ app: 'converter-pwa-youtube' })
  })

  it('shares on a touch device, downloads without file sharing, and reports a cancel', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { canShare: () => true, share })
    expect(await saveFile('a.json', '{}')).toBe('shared')
    share.mockRejectedValueOnce(new DOMException('cancel', 'AbortError'))
    expect(await saveFile('a.json', '{}')).toBe('cancelled')
    share.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'))
    expect(await saveFile('a.json', '{}')).toBe('downloaded')
    Object.assign(navigator, { canShare: undefined })
    expect(await saveFile('a.json', '{}')).toBe('downloaded')
    expect(click).toHaveBeenCalledTimes(2)
  })
})
