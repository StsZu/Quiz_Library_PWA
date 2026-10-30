// Export and import of progress (FR-40, FR-41). An invalid file never changes the stored data.
import { EXPORT_APP, EXPORT_SCHEMA, type Attempt, type ExportFile, type Mode } from '../contracts.ts'
import { db } from './storage/db.ts'

export const MAX_IMPORT_BYTES = 1024 * 1024
const MAX_ATTEMPTS = 20_000
const MODES: Mode[] = ['full', 'mistakes']

export function buildExport(attempts: Attempt[], appVersion: string, now = new Date()): ExportFile {
  return {
    app: EXPORT_APP,
    schemaVersion: EXPORT_SCHEMA,
    exportedAt: now.toISOString(),
    appVersion,
    data: { attempts: attempts.map(({ id: _id, ...rest }) => rest) },
  }
}

export function exportFileName(now = new Date()): string {
  return `quiz-library-${now.toISOString().slice(0, 10)}.json`
}

export type ImportResult = { ok: true; attempts: Attempt[] } | { ok: false; problems: string[] }

const isInt = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const isText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

function checkAttempt(value: unknown, where: string, problems: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${where}: має бути об'єктом`)
    return
  }
  const a = value as Record<string, unknown>
  const known = new Set(['quizId', 'contentHash', 'mode', 'startedAt', 'finishedAt', 'answers', 'score', 'total'])
  for (const key of Object.keys(a)) if (!known.has(key)) problems.push(`${where}: невідоме поле «${key}»`)
  if (!isText(a.quizId)) problems.push(`${where}: quizId має бути непорожнім рядком`)
  if (!isText(a.contentHash, 64)) problems.push(`${where}: contentHash має бути непорожнім рядком`)
  if (!MODES.includes(a.mode as Mode)) problems.push(`${where}: mode має бути «full» або «mistakes»`)
  if (!isTime(a.startedAt) || !isTime(a.finishedAt) || (a.finishedAt as number) < (a.startedAt as number)) {
    problems.push(`${where}: startedAt і finishedAt мають бути часом, finishedAt не раніше startedAt`)
  }
  if (!Array.isArray(a.answers)) {
    problems.push(`${where}: answers має бути масивом`)
    return
  }
  a.answers.forEach((answer: unknown, i) => {
    const x = answer as Record<string, unknown> | null
    if (!x || typeof x !== 'object' || !isText(x.key, 64) || !isInt(x.choice) || typeof x.correct !== 'boolean' || !isTime(x.at)) {
      problems.push(`${where}, відповідь ${i + 1}: потрібні key (рядок), choice (ціле ≥ 0), correct (true/false), at (час)`)
    }
  })
  if (!isInt(a.total) || a.answers.length > (a.total as number)) problems.push(`${where}: total має бути цілим і не меншим за кількість відповідей`)
  const correct = a.answers.filter((x: { correct?: unknown }) => x && x.correct === true).length
  if (!isInt(a.score) || a.score !== correct) problems.push(`${where}: score має дорівнювати кількості правильних відповідей (${correct})`)
}

/** Checks a file before anything is changed; returns the attempts or the list of problems. */
export function validateImport(text: string, bytes: number): ImportResult {
  if (bytes > MAX_IMPORT_BYTES) return { ok: false, problems: [`Файл завеликий: ${Math.ceil(bytes / 1024)} КБ, допустимо до ${MAX_IMPORT_BYTES / 1024} КБ`] }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, problems: ['Файл не є JSON'] }
  }
  const file = data as Partial<ExportFile> | null
  if (!file || typeof file !== 'object' || file.app !== EXPORT_APP) return { ok: false, problems: ['Це не файл експорту «Моїх квізів»'] }
  if (file.schemaVersion !== EXPORT_SCHEMA) {
    return { ok: false, problems: [`Непідтримувана версія формату: ${String(file.schemaVersion)}; очікується ${EXPORT_SCHEMA}. Оновіть застосунок.`] }
  }
  const attempts = file.data?.attempts
  if (!Array.isArray(attempts)) return { ok: false, problems: ['Немає списку спроб data.attempts'] }
  if (attempts.length > MAX_ATTEMPTS) return { ok: false, problems: [`Забагато спроб: ${attempts.length}`] }
  const problems: string[] = []
  attempts.forEach((attempt, i) => checkAttempt(attempt, `Спроба ${i + 1}`, problems))
  if (problems.length) return { ok: false, problems: problems.slice(0, 20).concat(problems.length > 20 ? [`… і ще ${problems.length - 20}`] : []) }
  return { ok: true, attempts: attempts as Attempt[] }
}

/** Replaces all progress with the imported attempts in one transaction; unfinished sessions are dropped. */
export async function replaceProgress(attempts: Attempt[]) {
  const database = await db()
  const tx = database.transaction(['attempts', 'inProgress'], 'readwrite')
  await tx.objectStore('attempts').clear()
  await tx.objectStore('inProgress').clear()
  for (const attempt of attempts) {
    const { id: _id, ...rest } = attempt
    await tx.objectStore('attempts').add(rest)
  }
  await tx.done
}
