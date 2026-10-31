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

// Spec 002: quiz files from disk (Creator_quiz/schemas/quiz-package.v1.schema.json).

export interface Fragment {
  id: string
  chapter: string
  paragraph?: number | null
  text: string
  start?: number | null
  end?: number | null
}

export interface PackageSource {
  material_id: string
  part_id?: string | null
  [key: string]: string | null | undefined
}

export interface PackageQuestion {
  id: string
  title: string
  question: string
  options: string[]
  correct: number
  feedback: string
  answer_fragment_ids?: string[]
  feedback_fragment_ids?: string[]
  reviewed: boolean
}

/** A file from disk after reading; a Creator_quiz wrapper is wrapped into the same shape. */
export interface QuizPackage {
  format: 'quiz-package'
  format_version: 1
  meta: QuizMeta & { shuffle?: boolean }
  strings?: Record<string, string>
  course?: { id: string; title: string }
  producer?: { app: string; version?: string; created_at?: string }
  source?: PackageSource
  fragments?: Fragment[]
  questions: PackageQuestion[]
}

export type PackageState = 'material' | 'draft' | 'ready'

export type WarningCode =
  | 'invisible' | 'nbsp' | 'unknownKey' | 'unknownStringKey' | 'unknownPlaceholder'
  | 'optionLabel' | 'sameCorrect' | 'duplicateTitles' | 'citation' | 'visualRef' | 'optionLength' | 'longestCorrect'

export interface PackageWarning {
  code: WarningCode
  message: string
}

export type ReadResult =
  | { ok: true; id: string; fileSlug: string; state: PackageState; package: QuizPackage; quiz: Quiz | null; warnings: PackageWarning[] }
  | { ok: false; problems: string[] }
