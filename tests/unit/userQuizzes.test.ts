// Spec 002, T106 (FR-65, FR-66, FR-70, FR-71, FR-73, ND4): quizzes from disk in the core.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { QuizPackage, ReadResult } from '../../src/contracts.ts'
import { allAttempts, allSessions, finishSession, recordAnswer, startSession } from '../../src/core/attempts.ts'
import { buildExport, validateImport } from '../../src/core/backup.ts'
import { loadQuiz } from '../../src/core/content.ts'
import { mistakeKeys } from '../../src/core/mistakes.ts'
import { readPackage } from '../../src/core/package.ts'
import { closeDB, DB_NAME } from '../../src/core/storage/db.ts'
import {
  deleteUserQuiz, getUserQuiz, isLocalId, listUserQuizzes, MY_FILES, planImport, questionDiff, saveUserQuiz, saveWorkingCopy, userCourses,
} from '../../src/core/userQuizzes.ts'

const fixtures = resolve(__dirname, '../fixtures/quiz-package')
const fixture = (name: string) => readFileSync(join(fixtures, name), 'utf8')
type Ok = Extract<ReadResult, { ok: true }>

async function read(text: string, name = 'lesson.json'): Promise<Ok> {
  const result = await readPackage(text, name)
  if (!result.ok) throw new Error(result.problems.join('\n'))
  return result
}

const q = (n: number, over: object = {}) => ({
  title: `Q${n}`, question: `Question ${n}?`, options: [`A${n}`, `B${n}`, `C${n}`], correct: n % 3, feedback: `Because ${n}.`, ...over,
})
const wrapper = (questions: object[], extra: object = {}) => JSON.stringify({ meta: { title: 'Lesson', lang: 'en' }, questions, ...extra })

beforeEach(async () => {
  await closeDB()
  await new Promise<void>((done) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = () => done() })
})

describe('add and update (FR-64, FR-65)', () => {
  it('plans new → stores → the same file is «already added»', async () => {
    const first = await read(fixture('01-package-ready.quiz.json'), 'lekcja-6.quiz.json')
    expect(await planImport(first)).toEqual({ kind: 'new' })
    const saved = await saveUserQuiz(first, 'lekcja-6.quiz.json', 1000)
    expect(saved).toMatchObject({ id: 'local-mat_689985a3039f', state: 'ready', course: { id: 'polski-lekcje', title: 'Polski — lekcje' }, addedAt: 1000, updatedAt: 1000 })
    const again = await read(fixture('01-package-ready.quiz.json'), 'copy.quiz.json')
    expect((await planImport(again)).kind).toBe('same')
  })

  it('counts new, changed and removed questions and keeps addedAt on update', async () => {
    await saveUserQuiz(await read(wrapper([q(1), q(2), q(3)])), 'lesson.json', 1000)
    const next = await read(wrapper([q(1), q(2, { question: 'Edited?' }), q(4), q(5)]))
    const plan = await planImport(next)
    expect(plan.kind === 'update' && plan.diff).toEqual({ added: 1, changed: 2, removed: 0, unchanged: 1 })
    const removed = await read(wrapper([q(1), q(2, { question: 'Edited?' })]))
    const planRemoved = await planImport(removed)
    expect(planRemoved.kind === 'update' && planRemoved.diff).toEqual({ added: 0, changed: 1, removed: 1, unchanged: 1 })
    const saved = await saveUserQuiz(next, 'lesson.json', 2000)
    expect([saved.addedAt, saved.updatedAt]).toEqual([1000, 2000])
  })

  it('matches questions of a package by id, so a new order changes nothing', async () => {
    const base = JSON.parse(fixture('01-package-ready.quiz.json'))
    const before = await saveUserQuiz(await read(JSON.stringify(base)), 'a.quiz.json')
    base.questions.reverse()
    base.questions.push({ ...base.questions[0], id: 'q3', question: 'New one?' })
    expect(await questionDiff(before, await read(JSON.stringify(base)))).toEqual({ added: 1, changed: 0, removed: 0, unchanged: 2 })
    base.questions.pop()
    base.questions[0].reviewed = false
    const plan = await planImport(await read(JSON.stringify(base)))
    expect(plan.kind === 'update' && plan.diff).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 2 })
  })

  it('keeps the mistake on an unchanged question after an update (SC-14)', async () => {
    const v1 = await read(wrapper([q(1), q(2), q(3), q(4), q(5)]))
    await saveUserQuiz(v1, 'lesson.json')
    const quiz = await loadQuiz(v1.id)
    let session = await startSession(quiz, 'full', quiz.questions.map((x) => x.key), 10)
    for (const [i, question] of quiz.questions.entries()) {
      const wrong = i === 1 || i === 4
      session = await recordAnswer(session, question.key, wrong ? (question.correct + 1) % 3 : question.correct, !wrong, 11 + i)
    }
    await finishSession(session, 100)
    expect(mistakeKeys(quiz, await allAttempts())).toEqual([quiz.questions[1].key, quiz.questions[4].key])

    const v2 = await read(wrapper([q(1), q(2), q(3), q(4), q(5, { options: ['A5', 'B5', 'Other'] })]))
    const plan = await planImport(v2)
    expect(plan.kind === 'update' && plan.diff).toEqual({ added: 0, changed: 1, removed: 0, unchanged: 4 })
    await saveUserQuiz(v2, 'lesson.json')
    const updated = await loadQuiz(v2.id)
    expect(updated.contentHash).not.toBe(quiz.contentHash)
    expect(mistakeKeys(updated, await allAttempts())).toEqual([quiz.questions[1].key])
    expect(await allAttempts()).toHaveLength(1)
  })
})

describe('delete (FR-71, ND4)', () => {
  it('removes the quiz and its unfinished sessions but keeps finished attempts', async () => {
    const result = await read(wrapper([q(1), q(2), q(3)]))
    await saveUserQuiz(result, 'lesson.json')
    const quiz = await loadQuiz(result.id)
    const done = await startSession(quiz, 'full', [quiz.questions[0].key], 1)
    await finishSession(await recordAnswer(done, quiz.questions[0].key, 0, false, 2), 3)
    const open = await startSession(quiz, 'mistakes', [quiz.questions[0].key], 4)
    await recordAnswer(open, quiz.questions[0].key, 1, false, 5)
    await deleteUserQuiz(result.id)
    expect(await getUserQuiz(result.id)).toBeUndefined()
    expect(await allSessions()).toEqual([])
    expect(await allAttempts()).toHaveLength(1)
    await expect(loadQuiz(result.id)).rejects.toThrow(/немає на пристрої/)
  })
})

describe('loading and courses (FR-70, FR-73)', () => {
  it('loads a quiz from disk through loadQuiz and refuses a material', async () => {
    const ready = await read(fixture('04-creator-wrapper.json'), 'w15.json')
    await saveUserQuiz(ready, 'w15.json')
    expect(isLocalId(ready.id)).toBe(true)
    expect(await loadQuiz(ready.id)).toEqual(ready.quiz)
    const material = await read(fixture('02-package-material.quiz.json'), 'm.quiz.json')
    await saveUserQuiz(material, 'm.quiz.json')
    await expect(loadQuiz(material.id)).rejects.toThrow(/матеріал без питань/)
  })

  it('groups by the file course, «Мої файли» for the rest, in the order of adding', async () => {
    await saveUserQuiz(await read(fixture('04-creator-wrapper.json'), 'b.json'), 'b.json', 1)
    await saveUserQuiz(await read(fixture('01-package-ready.quiz.json'), 'a.quiz.json'), 'a.quiz.json', 2)
    await saveUserQuiz(await read(fixture('22-keys-unicode.json'), 'c.json'), 'c.json', 3)
    const list = await listUserQuizzes()
    expect(list.map((x) => x.id)).toEqual(['local-b', 'local-mat_689985a3039f', 'local-c'])
    expect(userCourses(list).map((c) => [c.id, c.title, c.quizzes.map((x) => x.id)])).toEqual([
      [MY_FILES.id, MY_FILES.title, ['local-b', 'local-c']],
      ['polski-lekcje', 'Polski — lekcje', ['local-mat_689985a3039f']],
    ])
  })
})

describe('T109: drafts and files saved by the app', () => {
  it('does not play a draft', async () => {
    const draft = await read(fixture('03-package-draft.quiz.json'), 'd.quiz.json')
    await saveUserQuiz(draft, 'd.quiz.json')
    await expect(loadQuiz(draft.id)).rejects.toThrow(/чернетка/)
  })

  it('treats a file that differs only by producer as already added', async () => {
    const first = await read(fixture('01-package-ready.quiz.json'), 'a.quiz.json')
    await saveUserQuiz(first, 'a.quiz.json')
    const saved = { ...first.package, producer: { app: 'quiz-library', version: 'test', created_at: '2026-10-31T10:00:00.000Z' } }
    expect((await planImport(await read(JSON.stringify(saved), 'a.quiz.json'))).kind).toBe('same')
  })
})

describe('T112: working copy of the editor (FR-84, T111 decision)', () => {
  const complete = (pkg: QuizPackage, reviewed: boolean): QuizPackage => ({
    ...pkg,
    questions: [
      { id: 'q1', title: 'Temat', question: 'O czym jest lekcja?', options: ['Edukacja', 'Podróże', 'Zakupy'], correct: 0, feedback: 'O edukacji.', answer_fragment_ids: ['f1'], feedback_fragment_ids: ['f1'], reviewed },
      { id: 'q2', title: 'Zakres', question: 'Co należy do zakresu?', options: ['Pociąg', 'Internet', 'Lekarz'], correct: 1, feedback: 'Internet.', answer_fragment_ids: ['f2'], feedback_fragment_ids: ['f2'], reviewed },
    ],
  })

  it('keeps an invalid copy apart, turns a valid one into the package and never exports the copy', async () => {
    const material = await read(fixture('02-package-material.quiz.json'), 'm.quiz.json')
    await saveUserQuiz(material, 'm.quiz.json', 1000)
    const unfinished = { ...material.package, questions: [{ id: 'q1', title: 'Nowe pytanie', question: '', options: ['', '', ''], correct: 0, feedback: '', reviewed: false }] }
    const first = await saveWorkingCopy(material.id, unfinished, 2000)
    expect(first.valid).toBe(false)
    expect([first.record.state, first.record.package.questions.length, first.record.updatedAt]).toEqual(['material', 0, 1000])
    expect(first.record.workingCopy).toEqual(unfinished)
    const exported = buildExport([], 'test', new Date(), [first.record]).data.userQuizzes[0]
    expect(exported).not.toHaveProperty('workingCopy')
    const text = JSON.stringify(buildExport([], 'test', new Date(), [first.record]))
    expect((await validateImport(text, text.length)).ok).toBe(true)

    const draft = await saveWorkingCopy(material.id, complete(material.package, false), 3000)
    expect(draft.valid).toBe(true)
    expect([draft.record.state, draft.record.workingCopy, draft.record.updatedAt]).toEqual(['draft', undefined, 3000])
    await expect(loadQuiz(material.id)).rejects.toThrow(/чернетка/)

    const ready = await saveWorkingCopy(material.id, complete(material.package, true), 4000)
    expect(ready.record.state).toBe('ready')
    expect((await loadQuiz(material.id)).questions).toHaveLength(2)
    const again = await saveWorkingCopy(material.id, complete(material.package, true), 5000)
    expect(again.record.updatedAt).toBe(4000)
    await expect(saveWorkingCopy('local-missing', material.package)).rejects.toThrow(/немає на пристрої/)
  })
})
