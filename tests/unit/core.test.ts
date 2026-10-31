import { beforeEach, describe, expect, it } from 'vitest'
import type { Attempt, Quiz } from '../../src/contracts.ts'
import { allAttempts, allSessions, discardSession, finishSession, getSession, recordAnswer, startSession, statsByQuiz } from '../../src/core/attempts.ts'
import { buildExport, exportFileName, MAX_IMPORT_BYTES_V2, replaceProgress, validateImport } from '../../src/core/backup.ts'
import { mistakeCount, mistakeKeys } from '../../src/core/mistakes.ts'
import { closeDB, DB_NAME, getMeta, setMeta } from '../../src/core/storage/db.ts'

const quiz: Quiz = {
  id: 'q1',
  contentHash: 'h1',
  meta: { title: 'Quiz', description: '', lang: 'uk', dir: 'ltr' },
  strings: {},
  questions: [1, 2, 3, 4, 5].map((n) => ({ key: `k${n}`, title: `T${n}`, question: `Q${n}?`, options: ['a', 'b', 'c'], correct: 0, feedback: 'f' })),
}
const keys = quiz.questions.map((q) => q.key)

async function resetDB() {
  await closeDB()
  await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = () => resolve() })
}

/** Plays a full session: `wrong` lists the 1-based questions answered wrong. */
async function play(wrong: number[], start: number, mode: 'full' | 'mistakes' = 'full', over = keys) {
  let session = await startSession(quiz, mode, over, start)
  for (const [i, key] of over.entries()) {
    const n = keys.indexOf(key) + 1
    session = await recordAnswer(session, key, wrong.includes(n) ? 1 : 0, !wrong.includes(n), start + i + 1)
  }
  return finishSession(session, start + 100)
}

beforeEach(resetDB)

describe('attempts', () => {
  it('saves each answer at once and survives a relaunch (FR-30, FR-31)', async () => {
    let session = await startSession(quiz, 'full', keys, 1000)
    session = await recordAnswer(session, 'k1', 0, true, 1001)
    session = await recordAnswer(session, 'k1', 2, false, 1002)
    session = await recordAnswer(session, 'unknown', 0, true, 1003)
    expect(session.answers).toHaveLength(1)
    await closeDB()
    const restored = await getSession('q1', 'full')
    expect(restored?.answers).toEqual([{ key: 'k1', choice: 0, correct: true, at: 1001 }])
    expect(await getSession('q1', 'mistakes')).toBeUndefined()
  })

  it('turns a finished session into an attempt and removes the session', async () => {
    const attempt = await play([2, 5], 2000)
    expect(attempt).toMatchObject({ quizId: 'q1', mode: 'full', score: 3, total: 5, startedAt: 2000, finishedAt: 2100 })
    expect(attempt.id).toBeTypeOf('number')
    await closeDB()
    expect(await allAttempts()).toHaveLength(1)
    expect(await allSessions()).toEqual([])
  })

  it('discards a session', async () => {
    await startSession(quiz, 'full', keys, 1)
    await discardSession('q1', 'full')
    expect(await getSession('q1', 'full')).toBeUndefined()
  })

  it('counts attempts and keeps the latest per quiz (FR-10)', async () => {
    await play([1], 1000)
    await play([], 3000)
    const stats = statsByQuiz(await allAttempts()).get('q1')!
    expect(stats.attempts).toBe(2)
    expect(stats.last?.score).toBe(5)
  })

  it('stores and reads meta values', async () => {
    await setMeta('persistAsked', true)
    expect(await getMeta('persistAsked')).toBe(true)
    expect(await getMeta('missing')).toBeUndefined()
  })
})

describe('mistakes (FR-32, FR-34, SC-04)', () => {
  it('lists the questions answered wrong, in quiz order', async () => {
    await play([5, 2], 1000)
    expect(mistakeKeys(quiz, await allAttempts())).toEqual(['k2', 'k5'])
  })

  it('a later correct answer removes a mistake, also from an unfinished session', async () => {
    await play([2, 5], 1000)
    const attempt = await play([5], 2000, 'mistakes', ['k2', 'k5'])
    expect(attempt).toMatchObject({ mode: 'mistakes', score: 1, total: 2 })
    expect(mistakeKeys(quiz, await allAttempts())).toEqual(['k5'])
    let session = await startSession(quiz, 'mistakes', ['k5'], 3000)
    session = await recordAnswer(session, 'k5', 0, true, 3001)
    expect(mistakeKeys(quiz, await allAttempts(), [session])).toEqual([])
  })

  it('a later wrong answer in a full attempt adds a mistake again', async () => {
    await play([], 1000)
    await play([3], 2000)
    expect(mistakeKeys(quiz, await allAttempts())).toEqual(['k3'])
  })

  it('ignores questions whose content changed (FR-02)', async () => {
    await play([2, 5], 1000)
    const changed = { ...quiz, questions: quiz.questions.map((q) => (q.key === 'k2' ? { ...q, key: 'k2-new' } : q)) }
    const attempts = await allAttempts()
    expect(mistakeKeys(changed, attempts)).toEqual(['k5'])
    expect(mistakeCount('q1', new Set(changed.questions.map((q) => q.key)), attempts)).toBe(1)
    expect(mistakeCount('q1', null, attempts)).toBe(2)
    expect(mistakeCount('other', null, attempts)).toBe(0)
  })
})

describe('export and import (FR-40, FR-41, SC-06)', () => {
  const file = (attempts: Attempt[]) => JSON.stringify(buildExport(attempts, 'test', new Date('2026-10-30T10:00:00Z')))

  it('round-trips the attempts', async () => {
    await play([2], 1000)
    await play([], 2000, 'full')
    const before = await allAttempts()
    const text = file(before)
    expect(JSON.parse(text)).toMatchObject({ app: 'quiz-library', schemaVersion: 2, exportedAt: '2026-10-30T10:00:00.000Z', appVersion: 'test', data: { userQuizzes: [] } })
    await resetDB()
    const result = await validateImport(text, text.length)
    expect(result.ok).toBe(true)
    if (result.ok) await replaceProgress(result.attempts)
    const after = await allAttempts()
    const strip = (list: Attempt[]) => list.map(({ id: _id, ...rest }) => rest)
    expect(strip(after)).toEqual(strip(before))
  })

  it('names the export file by date', () => {
    expect(exportFileName(new Date('2026-10-30T10:00:00Z'))).toBe('quiz-library-2026-10-30.json')
  })

  it('rejects five kinds of invalid files without touching the data', async () => {
    await play([2], 1000)
    const valid = JSON.parse(file(await allAttempts()))
    const cases: [string, number, string][] = [
      ['{}', MAX_IMPORT_BYTES_V2 + 1, 'завеликий'],
      ['not json', 8, 'не є JSON'],
      [JSON.stringify({ ...valid, app: 'other' }), 30, 'не файл експорту'],
      [JSON.stringify({ ...valid, schemaVersion: 3 }), 30, 'Непідтримувана версія'],
      [JSON.stringify({ ...valid, data: { attempts: [{ ...valid.data.attempts[0], score: 'x', mode: 'exam', extra: 1 }] } }), 30, 'score'],
    ]
    for (const [text, bytes, message] of cases) {
      const result = await validateImport(text, bytes)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.problems.join('\n')).toContain(message)
    }
    expect(await allAttempts()).toHaveLength(1)
  })

  it('reports broken answers, times, totals and a missing list', async () => {
    const base = { quizId: 'q1', contentHash: 'h', mode: 'full', startedAt: 2, finishedAt: 1, score: 0, total: 0, answers: [{ key: '', choice: -1, correct: 'yes', at: 0 }] }
    const result = await validateImport(JSON.stringify({ app: 'quiz-library', schemaVersion: 1, data: { attempts: [base, 5] } }), 10)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const text = result.problems.join('\n')
      for (const part of ['startedAt', 'відповідь 1', 'total', "має бути об'єктом"]) expect(text).toContain(part)
    }
    const missing = await validateImport(JSON.stringify({ app: 'quiz-library', schemaVersion: 1, data: {} }), 10)
    expect(missing.ok).toBe(false)
    const noAnswers = await validateImport(JSON.stringify({ app: 'quiz-library', schemaVersion: 1, data: { attempts: [{ ...base, answers: 'x' }] } }), 10)
    expect(noAnswers.ok).toBe(false)
  })

  it('caps the problem list at 20 lines', async () => {
    const bad = Array.from({ length: 30 }, () => ({}))
    const result = await validateImport(JSON.stringify({ app: 'quiz-library', schemaVersion: 1, data: { attempts: bad } }), 10)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.at(-1)).toMatch(/і ще/)
  })
})
