// Quizzes from disk on the device (spec 002, FR-65, FR-66, FR-70, FR-71): add, update with a question diff, delete.
// Attempts are never touched here: a deleted or changed quiz keeps its history (ND4, FR-02 of spec 001).
import type { PackageQuestion, QuizPackage, ReadResult, UserQuiz } from '../contracts.ts'
import { sessionKey } from './attempts.ts'
import { db } from './storage/db.ts'

export const LOCAL_PREFIX = 'local-'
export const MY_FILES = { id: 'my-files', title: 'Мої файли' }

export const isLocalId = (id: string) => id.startsWith(LOCAL_PREFIX)

type ReadOk = Extract<ReadResult, { ok: true }>

export interface QuestionDiff {
  added: number
  changed: number
  removed: number
  unchanged: number
}

/** What opening a file would do (FR-64, FR-65); nothing is stored until `saveUserQuiz`. */
export type ImportPlan =
  | { kind: 'new' }
  | { kind: 'same'; existing: UserQuiz }
  | { kind: 'update'; existing: UserQuiz; diff: QuestionDiff }

export async function getUserQuiz(id: string): Promise<UserQuiz | undefined> {
  return (await db()).get('userQuizzes', id)
}

export async function listUserQuizzes(): Promise<UserQuiz[]> {
  return (await (await db()).getAll('userQuizzes')).sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))
}

/**
 * Questions are matched by their file id; an unmatched new and old question at the same position count as one
 * changed question (a Creator_quiz file has no ids, and an edit in place keeps the position). The question key
 * decides whether a matched question changed, so only the text, options or the correct index count.
 */
export async function questionDiff(before: UserQuiz, after: ReadOk): Promise<QuestionDiff> {
  const oldKeys = before.quiz?.questions.map((q) => q.key) ?? []
  const newKeys = after.quiz?.questions.map((q) => q.key) ?? []
  const oldQs = before.package.questions
  const newQs = after.package.questions
  const oldById = new Map(oldQs.map((q, i) => [q.id, i]))
  const matchedOld = new Set<number>()
  const diff: QuestionDiff = { added: 0, changed: 0, removed: 0, unchanged: 0 }
  const unmatchedNew: number[] = []
  newQs.forEach((q: PackageQuestion, i) => {
    const j = oldById.get(q.id)
    if (j === undefined) {
      unmatchedNew.push(i)
      return
    }
    matchedOld.add(j)
    if (oldKeys[j] === newKeys[i]) diff.unchanged++
    else diff.changed++
  })
  const unmatchedOld = new Set(oldQs.map((_, j) => j).filter((j) => !matchedOld.has(j)))
  for (const i of unmatchedNew) {
    if (unmatchedOld.has(i)) {
      unmatchedOld.delete(i)
      if (oldKeys[i] === newKeys[i]) diff.unchanged++
      else diff.changed++
    } else diff.added++
  }
  diff.removed = unmatchedOld.size
  return diff
}

/** Equal content; `producer` only says which app wrote the file (a file saved by this app is not an update). */
function samePackage(a: QuizPackage, b: QuizPackage): boolean {
  const { producer: _a, ...restA } = a
  const { producer: _b, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

export async function planImport(result: ReadOk): Promise<ImportPlan> {
  const existing = await getUserQuiz(result.id)
  if (!existing) return { kind: 'new' }
  if (samePackage(existing.package, result.package)) return { kind: 'same', existing }
  return { kind: 'update', existing, diff: await questionDiff(existing, result) }
}

/** Adds or replaces the quiz; an update keeps `addedAt`. Called only after the person confirms. */
export async function saveUserQuiz(result: ReadOk, fileName: string, now = Date.now()): Promise<UserQuiz> {
  const database = await db()
  const tx = database.transaction('userQuizzes', 'readwrite')
  const existing = await tx.store.get(result.id)
  const record: UserQuiz = {
    id: result.id,
    fileName,
    state: result.state,
    course: result.package.course ?? null,
    package: result.package,
    quiz: result.quiz,
    warnings: result.warnings,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
  }
  await tx.store.put(record)
  await tx.done
  return record
}

/** Removes the quiz and its unfinished sessions; finished attempts stay in the history and the export (ND4). */
export async function deleteUserQuiz(id: string) {
  const database = await db()
  const tx = database.transaction(['userQuizzes', 'inProgress'], 'readwrite')
  await tx.objectStore('userQuizzes').delete(id)
  await tx.objectStore('inProgress').delete(sessionKey(id, 'full'))
  await tx.objectStore('inProgress').delete(sessionKey(id, 'mistakes'))
  await tx.done
}

export interface UserCourse {
  id: string
  title: string
  quizzes: UserQuiz[]
}

/** FR-70: courses from the files' `course`, «Мої файли» for the rest; in the order the files were added. */
export function userCourses(quizzes: UserQuiz[]): UserCourse[] {
  const courses = new Map<string, UserCourse>()
  for (const quiz of quizzes) {
    const course = quiz.course ?? MY_FILES
    const entry = courses.get(course.id) ?? { id: course.id, title: course.title, quizzes: [] }
    entry.quizzes.push(quiz)
    courses.set(course.id, entry)
  }
  return [...courses.values()]
}
