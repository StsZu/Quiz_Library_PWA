// Quiz content imported from Creator_quiz into public/content/ (FR-01…FR-03).
import type { ContentIndex, Quiz } from '../contracts.ts'

const base = new URL('content/', document.baseURI)
const quizzes = new Map<string, Promise<Quiz>>()
let index: Promise<ContentIndex> | null = null

async function getJSON<T>(name: string): Promise<T> {
  const response = await fetch(new URL(name, base))
  if (!response.ok) throw new Error(`Не вдалося завантажити ${name}: ${response.status}`)
  return response.json() as Promise<T>
}

export function loadIndex(): Promise<ContentIndex> {
  index ??= getJSON<ContentIndex>('index.json').catch((error) => { index = null; throw error })
  return index
}

export function loadQuiz(id: string): Promise<Quiz> {
  let quiz = quizzes.get(id)
  if (!quiz) {
    quiz = getJSON<Quiz>(`${id}.json`).catch((error) => { quizzes.delete(id); throw error })
    quizzes.set(id, quiz)
  }
  return quiz
}
