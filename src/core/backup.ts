// Export and import of progress (FR-40, FR-41; spec 002, FR-90…FR-92). An invalid file never changes the stored data.
import {
  EXPORT_APP, EXPORT_SCHEMA, type Attempt, type ExportedUserQuiz, type ExportFile, type Mode, type UserQuiz,
} from '../contracts.ts'
import { readPackage } from './package.ts'
import { db } from './storage/db.ts'
import { LOCAL_PREFIX } from './userQuizzes.ts'

/** Limit of a version 1 file (spec 001, FR-41). */
export const MAX_IMPORT_BYTES = 1024 * 1024
/** Limit of a version 2 file: it may carry quizzes from disk of up to 2 MB each (FR-91). */
export const MAX_IMPORT_BYTES_V2 = 25 * 1024 * 1024
const MAX_ATTEMPTS = 20_000
const MAX_USER_QUIZZES = 500
const MAX_PROBLEMS = 20
const MODES: Mode[] = ['full', 'mistakes']
const SUPPORTED = [1, 2]

export function buildExport(attempts: Attempt[], appVersion: string, now = new Date(), userQuizzes: UserQuiz[] = []): ExportFile {
  return {
    app: EXPORT_APP,
    schemaVersion: EXPORT_SCHEMA,
    exportedAt: now.toISOString(),
    appVersion,
    data: {
      attempts: attempts.map(({ id: _id, ...rest }) => rest),
      userQuizzes: userQuizzes.map(({ id, fileName, state, course, package: pkg, addedAt, updatedAt }) => ({ id, fileName, state, course, package: pkg, addedAt, updatedAt })),
    },
  }
}

export function exportFileName(now = new Date()): string {
  return `quiz-library-${now.toISOString().slice(0, 10)}.json`
}

export type ImportResult =
  | { ok: true; schemaVersion: number; attempts: Attempt[]; userQuizzes: UserQuiz[] }
  | { ok: false; problems: string[] }

const isInt = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const isText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const tooBig = (bytes: number, limit: number) => `Файл завеликий: ${Math.ceil(bytes / 1024)} КБ, допустимо до ${limit / 1024} КБ`
const capped = (problems: string[]) => problems.slice(0, MAX_PROBLEMS).concat(problems.length > MAX_PROBLEMS ? [`… і ще ${problems.length - MAX_PROBLEMS}`] : [])

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

/** FR-92: every quiz from disk passes FR-61 again and keeps the id it had on the other device. */
async function checkUserQuiz(value: unknown, where: string, problems: string[]): Promise<UserQuiz | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`${where}: має бути об'єктом`)
    return null
  }
  const q = value as Record<keyof ExportedUserQuiz, unknown>
  const known = new Set(['id', 'fileName', 'state', 'course', 'package', 'addedAt', 'updatedAt'])
  const before = problems.length
  for (const key of Object.keys(q)) if (!known.has(key)) problems.push(`${where}: невідоме поле «${key}»`)
  if (!isText(q.id, 200) || !q.id.startsWith(LOCAL_PREFIX)) problems.push(`${where}: id має починатися з «${LOCAL_PREFIX}»`)
  if (!isText(q.fileName, 255)) problems.push(`${where}: fileName має бути непорожнім рядком`)
  if (!isTime(q.addedAt) || !isTime(q.updatedAt) || (q.updatedAt as number) < (q.addedAt as number)) {
    problems.push(`${where}: addedAt і updatedAt мають бути часом, updatedAt не раніше addedAt`)
  }
  if (!q.package || typeof q.package !== 'object' || Array.isArray(q.package)) problems.push(`${where}: немає об'єкта package`)
  if (problems.length > before) return null
  const read = await readPackage(JSON.stringify(q.package), q.fileName as string)
  if (!read.ok) {
    problems.push(...read.problems.map((p) => `${where} («${q.id as string}»): ${p}`))
    return null
  }
  if (read.id !== q.id) {
    problems.push(`${where}: id «${q.id as string}» не збігається з вмістом файлу («${read.id}»)`)
    return null
  }
  return {
    id: read.id, fileName: q.fileName as string, state: read.state, course: read.package.course ?? null,
    package: read.package, quiz: read.quiz, warnings: read.warnings, addedAt: q.addedAt as number, updatedAt: q.updatedAt as number,
  }
}

/** Checks a file of version 1 or 2 before anything is changed; returns what to import or the list of problems. */
export async function validateImport(text: string, bytes: number): Promise<ImportResult> {
  if (bytes > MAX_IMPORT_BYTES_V2) return { ok: false, problems: [tooBig(bytes, MAX_IMPORT_BYTES_V2)] }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, problems: ['Файл не є JSON'] }
  }
  const file = data as { app?: unknown; schemaVersion?: unknown; data?: { attempts?: unknown; userQuizzes?: unknown } } | null
  if (!file || typeof file !== 'object' || file.app !== EXPORT_APP) return { ok: false, problems: ['Це не файл експорту «Моїх квізів»'] }
  const version = file.schemaVersion
  if (!SUPPORTED.includes(version as number)) {
    return { ok: false, problems: [`Непідтримувана версія формату: ${String(version)}; підтримуються ${SUPPORTED.join(' і ')}. Оновіть застосунок.`] }
  }
  if (version === 1 && bytes > MAX_IMPORT_BYTES) return { ok: false, problems: [tooBig(bytes, MAX_IMPORT_BYTES)] }
  const attempts = file.data?.attempts
  if (!Array.isArray(attempts)) return { ok: false, problems: ['Немає списку спроб data.attempts'] }
  if (attempts.length > MAX_ATTEMPTS) return { ok: false, problems: [`Забагато спроб: ${attempts.length}`] }
  const problems: string[] = []
  attempts.forEach((attempt, i) => checkAttempt(attempt, `Спроба ${i + 1}`, problems))

  const raw = version === 2 ? file.data?.userQuizzes : []
  if (!Array.isArray(raw)) return { ok: false, problems: capped([...problems, 'Немає списку квізів з диска data.userQuizzes']) }
  if (raw.length > MAX_USER_QUIZZES) return { ok: false, problems: [`Забагато квізів з диска: ${raw.length}`] }
  const userQuizzes: UserQuiz[] = []
  const ids = new Set<string>()
  for (const [i, value] of raw.entries()) {
    const quiz = await checkUserQuiz(value, `Квіз з диска ${i + 1}`, problems)
    if (!quiz) continue
    if (ids.has(quiz.id)) problems.push(`Квіз з диска ${i + 1}: id «${quiz.id}» повторюється`)
    ids.add(quiz.id)
    userQuizzes.push(quiz)
  }
  if (problems.length) return { ok: false, problems: capped(problems) }
  return { ok: true, schemaVersion: version as number, attempts: attempts as Attempt[], userQuizzes }
}

export interface MergePlan {
  added: number
  updated: number
  kept: number
}

/** ND5: a quiz from the file is added when missing and replaces the stored one only when it is newer. */
export async function planMerge(userQuizzes: UserQuiz[]): Promise<MergePlan> {
  const store = (await db()).transaction('userQuizzes').store
  const plan: MergePlan = { added: 0, updated: 0, kept: 0 }
  for (const quiz of userQuizzes) {
    const existing = await store.get(quiz.id)
    if (!existing) plan.added++
    else if (quiz.updatedAt > existing.updatedAt) plan.updated++
    else plan.kept++
  }
  return plan
}

/**
 * One transaction: all attempts are replaced, unfinished sessions are dropped (spec 001, FR-41), quizzes from disk
 * are merged by `updatedAt` and none is deleted (ND5).
 */
export async function replaceProgress(attempts: Attempt[], userQuizzes: UserQuiz[] = []): Promise<MergePlan> {
  const database = await db()
  const tx = database.transaction(['attempts', 'inProgress', 'userQuizzes'], 'readwrite')
  await tx.objectStore('attempts').clear()
  await tx.objectStore('inProgress').clear()
  for (const attempt of attempts) {
    const { id: _id, ...rest } = attempt
    await tx.objectStore('attempts').add(rest)
  }
  const plan: MergePlan = { added: 0, updated: 0, kept: 0 }
  const store = tx.objectStore('userQuizzes')
  for (const quiz of userQuizzes) {
    const existing = await store.get(quiz.id)
    if (existing && quiz.updatedAt <= existing.updatedAt) {
      plan.kept++
      continue
    }
    await store.put(quiz)
    if (existing) plan.updated++
    else plan.added++
  }
  await tx.done
  return plan
}
