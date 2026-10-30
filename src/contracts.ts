// Data contracts (plan.md → «Контракти»): quiz content from Creator_quiz, attempts on the device, export file.

export interface QuizMeta {
  title: string
  description: string
  lang: string
  dir: 'ltr' | 'rtl'
}

/** UI strings of the quiz screen: the 30 keys of Creator_quiz spec 001 §8.3, resolved at import. */
export type QuizStrings = Record<string, string>

export interface Question {
  /** Changes whenever the question, its options or the correct index change (FR-02). */
  key: string
  title: string
  question: string
  options: string[]
  correct: number
  feedback: string
}

export interface Quiz {
  id: string
  contentHash: string
  meta: QuizMeta
  strings: QuizStrings
  questions: Question[]
}

export interface QuizSummary {
  id: string
  title: string
  lang: string
  questions: number
  contentHash: string
}

export interface Course {
  id: string
  title: string
  quizzes: QuizSummary[]
}

export interface ContentIndex {
  version: string
  courses: Course[]
}

export type Mode = 'full' | 'mistakes'

export interface Answer {
  key: string
  choice: number
  correct: boolean
  /** Epoch milliseconds. */
  at: number
}

export interface Attempt {
  id?: number
  quizId: string
  contentHash: string
  mode: Mode
  startedAt: number
  finishedAt: number
  answers: Answer[]
  score: number
  total: number
}

/** An unfinished session: the questions it shows and the answers given so far (FR-30, FR-31). */
export interface InProgress {
  quizId: string
  mode: Mode
  contentHash: string
  startedAt: number
  keys: string[]
  answers: Answer[]
}

export const EXPORT_APP = 'quiz-library'
export const EXPORT_SCHEMA = 1

export interface ExportFile {
  app: typeof EXPORT_APP
  schemaVersion: typeof EXPORT_SCHEMA
  exportedAt: string
  appVersion: string
  data: { attempts: Attempt[] }
}
