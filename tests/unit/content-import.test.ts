import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ContentIndex, Quiz } from '../../src/contracts.ts'

const root = resolve(__dirname, '../..')
const creator = resolve(root, '../Creator_quiz')
const hasCreator = existsSync(join(creator, 'tools', 'build_quiz.py'))
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

describe('imported content (public/content)', () => {
  const index = read<ContentIndex>(join(root, 'public/content/index.json'))

  it('lists the courses: Chysta chastota (10), tsykl (1) and English through AI (14)', () => {
    expect(index.courses.map((c) => [c.id, c.quizzes.length])).toEqual([
      ['chysta-chastota', 10], ['tsykl-pokrashchennia', 1], ['english-through-ai', 14],
    ])
  })

  it('has one file per quiz with the contract fields and unique question keys', () => {
    const files = readdirSync(join(root, 'public/content')).filter((f) => f !== 'index.json').sort()
    const ids = index.courses.flatMap((c) => c.quizzes.map((q) => `${q.id}.json`)).sort()
    expect(files).toEqual(ids)
    for (const course of index.courses) {
      for (const summary of course.quizzes) {
        const quiz = read<Quiz>(join(root, 'public/content', `${summary.id}.json`))
        expect(quiz.contentHash).toBe(summary.contentHash)
        expect(quiz.questions).toHaveLength(summary.questions)
        expect(Object.keys(quiz.strings)).toHaveLength(30)
        expect(new Set(quiz.questions.map((q) => q.key)).size).toBe(quiz.questions.length)
        for (const q of quiz.questions) expect(q.correct).toBeLessThan(q.options.length)
      }
    }
  })
})

describe.skipIf(!hasCreator)('import script (needs ../Creator_quiz)', () => {
  const run = (courses: object) => {
    const dir = mkdtempSync(join(tmpdir(), 'quiz-import-'))
    mkdirSync(join(dir, 'content'))
    writeFileSync(join(dir, 'content', 'courses.json'), JSON.stringify(courses))
    const result = spawnSync('python3', [join(root, 'scripts/import_quizzes.py'), join(dir, 'content/courses.json'), join(dir, 'out')], { encoding: 'utf8' })
    return { ...result, dir }
  }

  it('stops on a quiz that fails build_quiz.py and writes nothing (SC-01)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quiz-creator-'))
    mkdirSync(join(dir, 'OUTPUT_quiz'))
    cpSync(join(creator, 'tools'), join(dir, 'tools'), { recursive: true })
    cpSync(join(creator, 'templates'), join(dir, 'templates'), { recursive: true })
    cpSync(join(root, 'tests/fixtures/bad-quiz.json'), join(dir, 'OUTPUT_quiz/bad-quiz.json'))
    cpSync(join(creator, 'OUTPUT_quiz/chysta-chastota-ep01.json'), join(dir, 'OUTPUT_quiz/chysta-chastota-ep01.json'))
    const result = run({ source: dir, courses: [{ id: 'c', title: 'C', quizzes: ['chysta-chastota-ep01', 'bad-quiz'] }] })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('"correct" is 5')
    expect(result.stderr).toContain('nothing was written')
    expect(existsSync(join(result.dir, 'out'))).toBe(false)
  })

  it('gives a new question key when the question changes (FR-02)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quiz-creator-'))
    mkdirSync(join(dir, 'OUTPUT_quiz'))
    cpSync(join(creator, 'tools'), join(dir, 'tools'), { recursive: true })
    cpSync(join(creator, 'templates'), join(dir, 'templates'), { recursive: true })
    const source = read<{ questions: { question: string }[] }>(join(creator, 'OUTPUT_quiz/chysta-chastota-ep01.json'))
    source.questions[1].question += ' (змінено)'
    writeFileSync(join(dir, 'OUTPUT_quiz/chysta-chastota-ep01.json'), JSON.stringify(source))
    const result = run({ source: dir, courses: [{ id: 'c', title: 'C', quizzes: ['chysta-chastota-ep01'] }] })
    expect(result.status).toBe(0)
    const changed = read<Quiz>(join(result.dir, 'out/chysta-chastota-ep01.json'))
    const original = read<Quiz>(join(root, 'public/content/chysta-chastota-ep01.json'))
    expect(changed.questions[0].key).toBe(original.questions[0].key)
    expect(changed.questions[1].key).not.toBe(original.questions[1].key)
    expect(changed.contentHash).not.toBe(original.contentHash)
  })

  it('reproduces the committed content byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quiz-import-'))
    execFileSync('python3', [join(root, 'scripts/import_quizzes.py'), join(root, 'content/courses.json'), dir], { stdio: 'pipe' })
    for (const name of readdirSync(join(root, 'public/content'))) {
      expect(readFileSync(join(dir, name), 'utf8')).toBe(readFileSync(join(root, 'public/content', name), 'utf8'))
    }
  })
})
