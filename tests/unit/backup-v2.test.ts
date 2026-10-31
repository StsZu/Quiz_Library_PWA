// Spec 002, T107 (FR-90…FR-92, ND5, SC-18): export version 2 carries quizzes from disk; import reads 1 and 2.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Attempt, ReadResult, UserQuiz } from '../../src/contracts.ts'
import { allAttempts } from '../../src/core/attempts.ts'
import { buildExport, MAX_IMPORT_BYTES, planMerge, replaceProgress, validateImport } from '../../src/core/backup.ts'
import { readPackage } from '../../src/core/package.ts'
import { closeDB, db, DB_NAME } from '../../src/core/storage/db.ts'
import { listUserQuizzes, saveUserQuiz } from '../../src/core/userQuizzes.ts'

const fixtures = resolve(__dirname, '../fixtures/quiz-package')
const fixture = (name: string) => readFileSync(join(fixtures, name), 'utf8')
/** Fixture 02 shares the material id of fixture 01; its own id keeps both on one device. */
const materialText = () => fixture('02-package-material.quiz.json').replace('"mat_689985a3039f"', '"mat_material"')
const NOW = new Date('2026-10-31T10:00:00Z')

async function read(name: string, fileName = name, text = fixture(name)): Promise<Extract<ReadResult, { ok: true }>> {
  const result = await readPackage(text, fileName)
  if (!result.ok) throw new Error(result.problems.join('\n'))
  return result
}

const attempt = (n: number): Attempt => ({
  quizId: 'local-mat_689985a3039f', contentHash: 'h', mode: 'full', startedAt: 1000 + n, finishedAt: 2000 + n,
  answers: [{ key: 'k', choice: 0, correct: true, at: 1500 + n }], score: 1, total: 1,
})

async function resetDB() {
  await closeDB()
  await new Promise<void>((done) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = () => done() })
}

async function exportText(): Promise<string> {
  return JSON.stringify(buildExport(await allAttempts(), 'test', NOW, await listUserQuizzes()))
}

async function snapshot() {
  return { attempts: (await allAttempts()).map(({ id: _id, ...rest }) => rest), quizzes: await listUserQuizzes() }
}

beforeEach(resetDB)

describe('round trip (SC-18)', () => {
  it('exports attempts and quizzes from disk and imports them back identically', async () => {
    await saveUserQuiz(await read('01-package-ready.quiz.json', 'lekcja-6.quiz.json'), 'lekcja-6.quiz.json', 1000)
    await saveUserQuiz(await read('02-package-material.quiz.json', 'material.quiz.json', materialText()), 'material.quiz.json', 2000)
    await saveUserQuiz(await read('04-creator-wrapper.json', 'w15.json'), 'w15.json', 3000)
    const database = await db()
    for (let n = 0; n < 3; n++) await database.add('attempts', attempt(n))
    const before = await snapshot()
    const text = await exportText()
    const file = JSON.parse(text)
    expect(file.schemaVersion).toBe(2)
    expect(Object.keys(file.data.userQuizzes[0]).sort()).toEqual(['addedAt', 'course', 'fileName', 'id', 'package', 'state', 'updatedAt'])

    await resetDB()
    const result = await validateImport(text, text.length)
    if (!result.ok) throw new Error(result.problems.join('\n'))
    expect(await planMerge(result.userQuizzes)).toEqual({ added: 3, updated: 0, kept: 0 })
    expect(await replaceProgress(result.attempts, result.userQuizzes)).toEqual({ added: 3, updated: 0, kept: 0 })
    expect(await snapshot()).toEqual(before)
  })

  it('still imports a version 1 file with its 1 MB limit', async () => {
    const v1 = JSON.stringify({ app: 'quiz-library', schemaVersion: 1, exportedAt: NOW.toISOString(), appVersion: 'old', data: { attempts: [attempt(1)] } })
    const result = await validateImport(v1, v1.length)
    expect(result.ok && [result.schemaVersion, result.attempts.length, result.userQuizzes]).toEqual([1, 1, []])
    const big = await validateImport(v1, MAX_IMPORT_BYTES + 1)
    expect(big.ok || big.problems[0]).toMatch(/завеликий.*1024 КБ/)
    const v2 = JSON.stringify(buildExport([attempt(1)], 'new', NOW))
    expect((await validateImport(v2, MAX_IMPORT_BYTES + 1)).ok).toBe(true)
  })
})

describe('merge of quizzes from disk (ND5)', () => {
  it('adds missing, replaces only older ones and deletes nothing', async () => {
    const ready = await read('01-package-ready.quiz.json', 'a.quiz.json')
    const wrapper = await read('04-creator-wrapper.json', 'w15.json')
    const unicode = await read('22-keys-unicode.json', 'u.json')
    await saveUserQuiz(ready, 'a.quiz.json', 1000)
    await saveUserQuiz(wrapper, 'w15.json', 1000)
    const text = await exportText()
    await resetDB()
    await saveUserQuiz(ready, 'a.quiz.json', 5000) // newer on this device: kept
    await saveUserQuiz(wrapper, 'w15.json', 500) // older on this device: replaced
    await saveUserQuiz(unicode, 'u.json', 700) // only on this device: stays
    const file = JSON.parse(text)
    file.data.userQuizzes.push({ id: 'local-mat_material', fileName: 'material.quiz.json', state: 'material', course: null, package: JSON.parse(materialText()), addedAt: 10, updatedAt: 10 })
    const result = await validateImport(JSON.stringify(file), 100)
    if (!result.ok) throw new Error(result.problems.join('\n'))
    const plan = await planMerge(result.userQuizzes)
    expect(plan).toEqual({ added: 1, updated: 1, kept: 1 })
    expect(await replaceProgress(result.attempts, result.userQuizzes)).toEqual(plan)
    const after = new Map((await listUserQuizzes()).map((q) => [q.id, q.updatedAt]))
    expect(Object.fromEntries(after)).toEqual({ [ready.id]: 5000, [wrapper.id]: 1000, [unicode.id]: 700, 'local-mat_material': 10 })
  })
})

describe('invalid version 2 files change nothing (FR-92)', () => {
  async function stored(): Promise<{ text: string; base: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    await saveUserQuiz(await read('04-creator-wrapper.json', 'w15.json'), 'w15.json', 1000)
    await (await db()).add('attempts', attempt(1))
    const text = await exportText()
    return { text, base: JSON.parse(text) }
  }

  it('rejects a broken package, a foreign id, repeats, unknown fields and a missing list', async () => {
    const { base } = await stored()
    const before = await snapshot()
    const variant = async (change: (file: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const file = structuredClone(base)
      change(file)
      const result = await validateImport(JSON.stringify(file), 100)
      return result.ok ? [] : result.problems
    }
    expect((await variant((f) => { f.data.userQuizzes[0].package.questions[0].correct = 7 }))[0]).toMatch(/^Квіз з диска 1 \(«local-w15»\): Питання 1.*correct/)
    expect((await variant((f) => { f.data.userQuizzes[0].id = 'local-other' }))[0]).toMatch(/не збігається з вмістом файлу/)
    expect((await variant((f) => { f.data.userQuizzes[0].id = 'w15' }))[0]).toMatch(/має починатися з «local-»/)
    expect((await variant((f) => { f.data.userQuizzes.push(structuredClone(f.data.userQuizzes[0])) }))[0]).toMatch(/повторюється/)
    expect((await variant((f) => { f.data.userQuizzes[0].extra = 1 }))[0]).toMatch(/невідоме поле «extra»/)
    expect((await variant((f) => { f.data.userQuizzes[0].updatedAt = 1 }))[0]).toMatch(/updatedAt не раніше addedAt/)
    expect((await variant((f) => { f.data.userQuizzes[0].package = [] }))[0]).toMatch(/немає об'єкта package/)
    expect(await variant((f) => { f.data.userQuizzes[0] = 5 })).toEqual(["Квіз з диска 1: має бути об'єктом"])
    expect(await variant((f) => { delete f.data.userQuizzes })).toEqual(['Немає списку квізів з диска data.userQuizzes'])
    expect(await variant((f) => { f.data.userQuizzes = Array.from({ length: 501 }, () => ({})) })).toEqual(['Забагато квізів з диска: 501'])
    expect(await snapshot()).toEqual(before)
  })

  it('reports attempt problems together with quiz problems', async () => {
    const { base } = await stored()
    base.data.attempts[0].score = 9
    base.data.userQuizzes[0].fileName = ''
    const result = await validateImport(JSON.stringify(base), 100)
    expect(result.ok || result.problems).toEqual([
      'Спроба 1: score має дорівнювати кількості правильних відповідей (1)',
      'Квіз з диска 1: fileName має бути непорожнім рядком',
    ])
  })
})

describe('export shape', () => {
  it('leaves out the recomputed fields', async () => {
    const quiz: UserQuiz = await saveUserQuiz(await read('01-package-ready.quiz.json'), 'a.quiz.json', 1)
    const [exported] = buildExport([], 'test', NOW, [quiz]).data.userQuizzes
    expect(exported).not.toHaveProperty('quiz')
    expect(exported).not.toHaveProperty('warnings')
  })
})
