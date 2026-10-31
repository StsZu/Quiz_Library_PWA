// Saving a quiz from disk back to a file (spec 002, FR-85): `<slug>.quiz.json` in the quiz-package v1 format.
// On a touch device with file sharing (iPad, iPhone) the share sheet offers «Зберегти у Файли»; a download link in
// an installed iOS PWA is unreliable. Elsewhere (Mac) the file is downloaded.
import type { QuizPackage, UserQuiz } from '../contracts.ts'
import { slugOf } from '../core/package.ts'

export const PRODUCER_APP = 'quiz-library'

export function packageFileName(quiz: Pick<UserQuiz, 'fileName'>): string {
  return `${slugOf(quiz.fileName)}.quiz.json`
}

/** The stored package with this app as its producer; content, source and fragments stay as they were. */
export function packageForSave(quiz: Pick<UserQuiz, 'package'>, appVersion: string, now = new Date()): QuizPackage {
  return { ...quiz.package, producer: { app: PRODUCER_APP, version: appVersion, created_at: now.toISOString() } }
}

export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'

export async function saveFile(name: string, text: string, type = 'application/json'): Promise<SaveOutcome> {
  const file = new File([text], name, { type })
  if (navigator.maxTouchPoints > 0 && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Sharing refused (no gesture, not allowed): fall back to a download.
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

export function saveUserQuizFile(quiz: UserQuiz): Promise<SaveOutcome> {
  return saveFile(packageFileName(quiz), JSON.stringify(packageForSave(quiz, __APP_VERSION__), null, 1) + '\n')
}
