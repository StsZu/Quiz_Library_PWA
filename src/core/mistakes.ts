// Mistakes: a question is a mistake when its latest answer, in any mode, was wrong (FR-32).
// Questions that no longer exist in the quiz (changed or removed content) are ignored (FR-02).
import type { Answer, Attempt, InProgress, Quiz } from '../contracts.ts'

function latestAnswers(quizId: string, attempts: Attempt[], sessions: InProgress[]): Map<string, Answer> {
  const latest = new Map<string, Answer>()
  const answers = [
    ...attempts.filter((a) => a.quizId === quizId).flatMap((a) => a.answers),
    ...sessions.filter((s) => s.quizId === quizId).flatMap((s) => s.answers),
  ]
  for (const answer of answers) {
    const seen = latest.get(answer.key)
    if (!seen || answer.at >= seen.at) latest.set(answer.key, answer)
  }
  return latest
}

/** Keys of the quiz questions that are mistakes, in quiz order. */
export function mistakeKeys(quiz: Pick<Quiz, 'id' | 'questions'>, attempts: Attempt[], sessions: InProgress[] = []): string[] {
  const latest = latestAnswers(quiz.id, attempts, sessions)
  return quiz.questions.filter((q) => latest.get(q.key)?.correct === false).map((q) => q.key)
}

/** Mistakes count without the quiz content: answers whose keys belong to `validKeys`. */
export function mistakeCount(quizId: string, validKeys: Set<string> | null, attempts: Attempt[], sessions: InProgress[] = []): number {
  let count = 0
  for (const [key, answer] of latestAnswers(quizId, attempts, sessions)) {
    if (!answer.correct && (!validKeys || validKeys.has(key))) count += 1
  }
  return count
}
