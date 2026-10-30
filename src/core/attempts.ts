// Attempts: every answer is stored at once; a finished session becomes an attempt (FR-30, FR-31, FR-34).
import type { Answer, Attempt, InProgress, Mode, Quiz } from '../contracts.ts'
import { db } from './storage/db.ts'

const sessionKey = (quizId: string, mode: Mode) => `${quizId}|${mode}`

export async function getSession(quizId: string, mode: Mode): Promise<InProgress | undefined> {
  return (await db()).get('inProgress', sessionKey(quizId, mode))
}

export async function allSessions(): Promise<InProgress[]> {
  return (await db()).getAll('inProgress')
}

/** A new session over `keys` (all questions or the mistakes); pure, see `saveSession`. */
export function newSession(quiz: Pick<Quiz, 'id' | 'contentHash'>, mode: Mode, keys: string[], now = Date.now()): InProgress {
  return { quizId: quiz.id, mode, contentHash: quiz.contentHash, startedAt: now, keys, answers: [] }
}

/** The session with one more answer; unchanged for an unknown or already answered question. */
export function withAnswer(session: InProgress, key: string, choice: number, correct: boolean, now = Date.now()): InProgress {
  if (!session.keys.includes(key) || session.answers.some((a) => a.key === key)) return session
  const answer: Answer = { key, choice, correct, at: now }
  return { ...session, answers: [...session.answers, answer] }
}

export function toAttempt(session: InProgress, now = Date.now()): Attempt {
  return {
    quizId: session.quizId,
    contentHash: session.contentHash,
    mode: session.mode,
    startedAt: session.startedAt,
    finishedAt: now,
    answers: session.answers,
    score: session.answers.filter((a) => a.correct).length,
    total: session.keys.length,
  }
}

export async function saveSession(session: InProgress) {
  await (await db()).put('inProgress', session, sessionKey(session.quizId, session.mode))
}

/** Starts a session, replacing an unfinished one of the same mode. */
export async function startSession(quiz: Quiz, mode: Mode, keys: string[], now = Date.now()): Promise<InProgress> {
  const session = newSession(quiz, mode, keys, now)
  await saveSession(session)
  return session
}

export async function recordAnswer(session: InProgress, key: string, choice: number, correct: boolean, now = Date.now()): Promise<InProgress> {
  const next = withAnswer(session, key, choice, correct, now)
  if (next !== session) await saveSession(next)
  return next
}

/** Saves the attempt and removes the session; returns the attempt with its id. */
export async function finishSession(session: InProgress, now = Date.now()): Promise<Attempt> {
  const attempt = toAttempt(session, now)
  const database = await db()
  const tx = database.transaction(['attempts', 'inProgress'], 'readwrite')
  const id = await tx.objectStore('attempts').add(attempt)
  await tx.objectStore('inProgress').delete(sessionKey(session.quizId, session.mode))
  await tx.done
  return { ...attempt, id }
}

export async function discardSession(quizId: string, mode: Mode) {
  await (await db()).delete('inProgress', sessionKey(quizId, mode))
}

export async function allAttempts(): Promise<Attempt[]> {
  return (await db()).getAll('attempts')
}

export interface QuizStats {
  attempts: number
  last: Attempt | null
}

/** Finished attempts per quiz and the latest one (FR-10, FR-53). */
export function statsByQuiz(attempts: Attempt[]): Map<string, QuizStats> {
  const stats = new Map<string, QuizStats>()
  for (const attempt of attempts) {
    const entry = stats.get(attempt.quizId) ?? { attempts: 0, last: null }
    entry.attempts += 1
    if (!entry.last || attempt.finishedAt >= entry.last.finishedAt) entry.last = attempt
    stats.set(attempt.quizId, entry)
  }
  return stats
}
