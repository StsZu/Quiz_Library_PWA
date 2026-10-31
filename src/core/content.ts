// Quiz content imported from Creator_quiz into public/content/ (FR-01…FR-03) and quizzes from disk (spec 002, FR-73).
import type { ContentIndex, Quiz } from '../contracts.ts'
import { getUserQuiz, isLocalId } from './userQuizzes.ts'

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

/** A quiz from disk is read from IndexedDB each time (it can be updated or deleted); built-in ones are cached. */
async function loadUserQuiz(id: string): Promise<Quiz> {
  const stored = await getUserQuiz(id)
  if (!stored) throw new Error('Цього квізу немає на пристрої. Відкрийте його файл знову.')
  if (!stored.quiz) throw new Error('Це матеріал без питань. Спершу створіть питання.')
  if (stored.state === 'draft') throw new Error('Це чернетка: не всі питання переглянуто.')
  return stored.quiz
}

export function loadQuiz(id: string): Promise<Quiz> {
  if (isLocalId(id)) return loadUserQuiz(id)
  let quiz = quizzes.get(id)
  if (!quiz) {
    quiz = getJSON<Quiz>(`${id}.json`).catch((error) => { quizzes.delete(id); throw error })
    quizzes.set(id, quiz)
  }
  return quiz
}
