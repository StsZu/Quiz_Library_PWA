// Spec 002, T102 (F-05, SC-12): keys and hashes from the browser equal those of import_quizzes.py.
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Question, Quiz } from '../../src/contracts.ts'
import { contentHash, digest, pyJson, questionKey, sha256Hex, type PyValue } from '../../src/core/canonical.ts'

const root = resolve(__dirname, '../..')
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

describe('pyJson', () => {
  it('matches Python json.dumps(ensure_ascii=False, sort_keys=True) on tricky values', () => {
    const cases = read<{ input: PyValue; python: string }[]>(join(root, 'tests/fixtures/canonical.json'))
    expect(cases.length).toBeGreaterThanOrEqual(7)
    for (const c of cases) expect(pyJson(c.input)).toBe(c.python)
  })

  it('rejects floats and lone surrogates instead of hashing them differently from Python', () => {
    expect(() => pyJson(1.5)).toThrow(/integers/)
    expect(() => pyJson(['ok', '\uD83D'])).toThrow(/surrogate/)
    expect(() => pyJson('\uDE00 tail')).toThrow(/surrogate/)
    expect(() => pyJson('end \uD83D')).toThrow(/surrogate/)
    expect(pyJson('😀')).toBe('"😀"')
  })

  it('hashes UTF-8 bytes with SHA-256', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await digest('źdźbło')).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('question keys of the shared fixtures (keys.json from Python)', () => {
  const dir = join(root, 'tests/fixtures/quiz-package')
  const keys = read<Record<string, string[]>>(join(dir, 'keys.json'))

  it('are equal for every accepted fixture', async () => {
    for (const [name, expected] of Object.entries(keys)) {
      const data = read<{ questions: Question[] }>(join(dir, name))
      expect(await Promise.all(data.questions.map(questionKey)), name).toEqual(expected)
    }
  })
})

describe('built-in content (public/content from import_quizzes.py)', () => {
  const dir = join(root, 'public/content')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')

  it('covers all 25 quizzes', () => {
    expect(files).toHaveLength(25)
  })

  it('gives the same question keys and content hash', async () => {
    for (const file of files) {
      const quiz = read<Quiz>(join(dir, file))
      const keys = await Promise.all(quiz.questions.map(questionKey))
      expect(keys, file).toEqual(quiz.questions.map((q) => q.key))
      const { contentHash: stored, ...rest } = quiz
      expect(await contentHash(rest), file).toBe(stored)
    }
  })
})
