// Spec 002, T105 (FR-66, SC-13, constitution III.1): the upgrade to version 2 keeps every attempt and session.
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Attempt, InProgress } from '../../src/contracts.ts'
import { allAttempts, allSessions } from '../../src/core/attempts.ts'
import { closeDB, db, DB_NAME, DB_VERSION, getMeta } from '../../src/core/storage/db.ts'

async function deleteDB() {
  await closeDB()
  await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = () => resolve() })
}

/** The database exactly as release 1 (commit 0624246) created it. */
async function openVersion1() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      const attempts = database.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true })
      attempts.createIndex('quizId', 'quizId')
      database.createObjectStore('inProgress')
      database.createObjectStore('meta')
    },
  })
}

const attempt = (n: number): Attempt => ({
  quizId: `chysta-chastota-ep${String((n % 10) + 1).padStart(2, '0')}`,
  contentHash: `h${n % 3}`,
  mode: n % 4 === 0 ? 'mistakes' : 'full',
  startedAt: 1_790_000_000_000 + n * 1000,
  finishedAt: 1_790_000_000_500 + n * 1000,
  answers: [{ key: `k${n}`, choice: n % 3, correct: n % 2 === 0, at: 1_790_000_000_100 + n * 1000 }],
  score: n % 2 === 0 ? 1 : 0,
  total: 1,
})

const session: InProgress = {
  quizId: 'english-through-ai-w01', mode: 'full', contentHash: 'abc', startedAt: 1_790_000_100_000,
  keys: ['a', 'b', 'c'], answers: [{ key: 'a', choice: 2, correct: false, at: 1_790_000_100_500 }],
}

beforeEach(deleteDB)

describe('IndexedDB version 2', () => {
  it('keeps 50 attempts, an unfinished session and meta of version 1, and adds an empty userQuizzes', async () => {
    const old = await openVersion1()
    for (let n = 0; n < 50; n++) await old.add('attempts', attempt(n))
    await old.put('inProgress', session, 'english-through-ai-w01|full')
    await old.put('meta', true, 'persistAsked')
    const before = { attempts: await old.getAll('attempts'), sessions: await old.getAll('inProgress') }
    old.close()

    const database = await db()
    expect(database.version).toBe(DB_VERSION)
    expect([...database.objectStoreNames].sort()).toEqual(['attempts', 'inProgress', 'meta', 'userQuizzes'])
    expect(await allAttempts()).toEqual(before.attempts)
    expect(before.attempts).toHaveLength(50)
    expect(await allSessions()).toEqual(before.sessions)
    expect(await getMeta('persistAsked')).toBe(true)
    expect(await database.count('userQuizzes')).toBe(0)
    expect(database.transaction('attempts').store.indexNames.contains('quizId')).toBe(true)

    await closeDB()
    expect(await allAttempts()).toEqual(before.attempts)
  })

  it('creates all stores on a fresh device', async () => {
    const database = await db()
    expect([...database.objectStoreNames].sort()).toEqual(['attempts', 'inProgress', 'meta', 'userQuizzes'])
    await database.put('userQuizzes', { id: 'local-x' } as never)
    expect(await database.getAllKeys('userQuizzes')).toEqual(['local-x'])
  })

  it('steps aside when a newer version opens in another tab', async () => {
    await db()
    const newer = await openDB(DB_NAME, DB_VERSION + 1)
    expect(newer.version).toBe(DB_VERSION + 1)
    newer.close()
  })
})
