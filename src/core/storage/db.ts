// IndexedDB `quiz-library` (plan.md → «Контракти»). Attempts and unfinished sessions stay on the device.
// Version 2 (spec 002, FR-66) adds `userQuizzes`; the upgrade never touches the stores of version 1.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Attempt, InProgress, UserQuiz } from '../../contracts.ts'

export const DB_NAME = 'quiz-library'
export const DB_VERSION = 2

interface Schema extends DBSchema {
  attempts: { key: number; value: Attempt; indexes: { quizId: string } }
  inProgress: { key: string; value: InProgress }
  meta: { key: string; value: unknown }
  userQuizzes: { key: string; value: UserQuiz }
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

export function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const attempts = database.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true })
        attempts.createIndex('quizId', 'quizId')
        database.createObjectStore('inProgress')
        database.createObjectStore('meta')
      }
      if (oldVersion < 2) database.createObjectStore('userQuizzes', { keyPath: 'id' })
    },
    // A newer version opened in another tab: let it upgrade instead of waiting for this tab to close.
    blocking() {
      void closeDB()
    },
  })
  return dbPromise
}

/** Test hook: forget the open connection so the next call reopens (simulates a relaunch). */
export async function closeDB() {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await (await db()).put('meta', value, key)
}
