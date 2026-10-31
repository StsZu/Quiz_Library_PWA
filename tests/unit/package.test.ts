// Spec 002, T104 (F-01…F-06, FR-61…FR-63, SC-11): the browser reads quiz files as build_quiz.py does.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Quiz, ReadResult, WarningCode } from '../../src/contracts.ts'
import { buildQuiz, decodeUtf8, MAX_FILE_BYTES, readPackage, slugOf } from '../../src/core/package.ts'

const root = resolve(__dirname, '../..')
const dir = join(root, 'tests/fixtures/quiz-package')
const creatorOutput = resolve(root, '../Creator_quiz/OUTPUT_quiz')
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const CONTENT: WarningCode[] = ['optionLabel', 'sameCorrect', 'duplicateTitles', 'citation', 'visualRef', 'optionLength', 'longestCorrect']

interface Expected { app: 'accept' | 'reject'; state?: string; app_warnings?: WarningCode[] }
const expected = read<Record<string, Expected>>(join(dir, 'expected.json'))
const keys = read<Record<string, string[]>>(join(dir, 'keys.json'))
const fixture = (name: string) => readFileSync(join(dir, name), 'utf8')

const ok = (result: ReadResult) => {
  if (!result.ok) throw new Error(result.problems.join('\n'))
  return result
}
const problems = (result: ReadResult) => (result.ok ? [] : result.problems)
const wrapper = (questions: unknown[], meta: object = { title: 'T', lang: 'en' }) => JSON.stringify({ meta, questions })
const q = (over: object = {}) => ({ title: 'Q', question: 'Which?', options: ['One', 'Two', 'Three'], correct: 1, feedback: 'Because.', ...over })

describe('shared fixtures (expected.json, keys.json)', () => {
  for (const [name, entry] of Object.entries(expected)) {
    it(`${name}: ${entry.app}${entry.state ? ` (${entry.state})` : ''}`, async () => {
      const result = await readPackage(fixture(name), name)
      expect(result.ok, problems(result).join('\n')).toBe(entry.app === 'accept')
      if (!result.ok) {
        expect(result.problems.length).toBeGreaterThan(0)
        return
      }
      expect(result.state).toBe(entry.state)
      const codes = [...new Set(result.warnings.map((w) => w.code).filter((c) => CONTENT.includes(c)))].sort()
      expect(codes).toEqual([...(entry.app_warnings ?? [])].sort())
      expect(result.quiz?.questions.map((x) => x.key) ?? []).toEqual(keys[name])
    })
  }

  it('rejects a file over 2 MB before reading it', async () => {
    const result = await readPackage(fixture('04-creator-wrapper.json'), 'big.json', MAX_FILE_BYTES + 1)
    expect(problems(result)[0]).toMatch(/завеликий/)
  })

  it('round-trips: the stored package reads back to the same quiz', async () => {
    for (const name of ['01-package-ready.quiz.json', '04-creator-wrapper.json', '22-keys-unicode.json']) {
      const first = ok(await readPackage(fixture(name), name))
      const again = ok(await readPackage(JSON.stringify(first.package), name))
      expect([again.id, again.state, again.quiz?.contentHash]).toEqual([first.id, first.state, first.quiz?.contentHash])
    }
  })
})

describe.skipIf(!existsSync(creatorOutput))('built-in content from its Creator_quiz sources (needs ../Creator_quiz)', () => {
  it('normalizes every source exactly as import_quizzes.py did (keys, strings, meta, content hash)', async () => {
    const files = readdirSync(join(root, 'public/content')).filter((f) => f !== 'index.json')
    expect(files).toHaveLength(25)
    for (const file of files) {
      const stored = read<Quiz>(join(root, 'public/content', file))
      const result = ok(await readPackage(readFileSync(join(creatorOutput, file), 'utf8'), file))
      expect(result.id).toBe(`local-${stored.id}`)
      const quiz = await buildQuiz(stored.id, result.quiz!.meta, result.quiz!.strings, result.package.questions)
      expect(quiz, file).toEqual(stored)
    }
  })
})

describe('reading like read_json_file', () => {
  it('removes invisible characters everywhere and warns', async () => {
    const text = '﻿' + wrapper([q({ question: 'Wh​ich?' }), q({ question: 'Two⁠?' }), q({ question: 'Three?' })])
    const result = ok(await readPackage(text, 'x.json'))
    expect(result.warnings.find((w) => w.code === 'invisible')?.message).toMatch(/: 3$/)
    expect(result.package.questions[0].question).toBe('Which?')
  })

  it('accepts a Markdown fence and NBSP outside strings', async () => {
    const fenced = '```json\n' + wrapper([q()]).replace('{"meta"', '{ "meta"') + '\n```'
    const result = ok(await readPackage(fenced, 'x.json'))
    expect(result.warnings.map((w) => w.code)).toContain('nbsp')
    expect(problems(await readPackage('{"meta": ', 'x.json'))[0]).toMatch(/не є JSON/)
  })

  it('keeps the Python difference between 1 and 1.0', async () => {
    expect((await readPackage(wrapper([q({ correct: 1 })]), 'x.json')).ok).toBe(true)
    expect(problems(await readPackage(wrapper([q()]).replace('"correct":1', '"correct":1.0'), 'x.json'))[0]).toMatch(/цілим числом, а не 1\.0/)
    expect(problems(await readPackage(wrapper([q()]).replace('"correct":1', '"correct":1e0'), 'x.json'))[0]).toMatch(/цілим/)
    const pkg = JSON.parse(fixture('01-package-ready.quiz.json'))
    pkg.fragments[0].start = 0
    const text = JSON.stringify(pkg).replace('"start":0', '"start":12.5')
    expect(ok(await readPackage(text, 'x.json')).package.fragments?.[0].start).toBe(12.5)
  })

  it('decodes UTF-8 strictly', () => {
    expect(decodeUtf8(new TextEncoder().encode('źdźbło').buffer as ArrayBuffer)).toEqual({ ok: true, text: 'źdźbło' })
    expect(decodeUtf8(new Uint8Array([0x7b, 0xff, 0x7d]).buffer)).toEqual({ ok: false, problem: 'Файл не в кодуванні UTF-8' })
  })
})

describe('checks', () => {
  it('reports every question problem in Ukrainian with its number', async () => {
    const list = problems(await readPackage(wrapper([q({ title: ' ' }), q({ options: 'abc' }), q({ correct: true }), { title: 'x' }, 5]), 'x.json'))
    expect(list).toEqual(expect.arrayContaining([
      'Питання 1: «title» має бути непорожнім рядком',
      'Питання 2 («Q»): «options» має бути масивом',
      'Питання 3 («Q»): «correct» має бути цілим числом, а не true',
      'Питання 4 («x»): немає «question»',
      'Питання 5: має бути об\'єктом',
    ]))
  })

  it('checks meta, strings and limits', async () => {
    expect(problems(await readPackage(wrapper([q()], { title: 5, lang: 'en' }), 'x.json'))).toEqual(['meta.title має бути рядком'])
    expect(problems(await readPackage(wrapper([q()], { title: 'T', lang: 'en', dir: 'up' }), 'x.json'))[0]).toMatch(/ltr або rtl/)
    expect(problems(await readPackage(wrapper([q()], { title: 'x'.repeat(201), lang: 'en' }), 'x.json'))[0]).toMatch(/200/)
    expect(problems(await readPackage(wrapper([]), 'x.json'))).toEqual(['Масив «questions» порожній'])
    expect(problems(await readPackage(wrapper(Array.from({ length: 201 }, (_, i) => q({ question: `Q${i}?` }))), 'x.json'))[0]).toMatch(/Забагато питань/)
    expect(problems(await readPackage(JSON.stringify({ meta: [], strings: 1, questions: [q()] }), 'x.json'))).toEqual(['«meta» має бути об\'єктом', '«strings» має бути об\'єктом'])
    expect(problems(await readPackage('"text"', 'x.json'))[0]).toMatch(/об'єкт/)
    expect(problems(await readPackage(JSON.stringify({ meta: { title: 'T', lang: 'en' } }), 'x.json'))).toEqual(['Немає масиву «questions»'])
    const bad = await readPackage(JSON.stringify({ meta: { title: 'T', lang: 'en' }, strings: { next: '' }, questions: [q()] }), 'x.json')
    expect(problems(bad)).toEqual(['strings.next має бути непорожнім рядком'])
  })

  it('resolves meta and strings like build_quiz.py', async () => {
    const text = JSON.stringify({ meta: { title: ' Arabic ', lang: 'ar', description: ' d ' }, strings: { ...read<{ strings: object }>(join(dir, '05-lang-without-preset-with-strings.json')).strings, extra: 'x', next: 'Next {n}' }, questions: [q()] })
    const result = ok(await readPackage(text, 'x.json'))
    expect(result.quiz!.meta).toEqual({ lang: 'ar', dir: 'rtl', title: 'Arabic', description: 'd' })
    expect(result.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['unknownStringKey', 'unknownPlaceholder']))
    expect(Object.keys(result.quiz!.strings)).toHaveLength(30)
  })

  it('warns about unknown keys of a Creator_quiz wrapper but not about package fields', async () => {
    const wrapped = ok(await readPackage(JSON.stringify({ meta: { title: 'T', lang: 'en', theme: 1 }, extra: 1, questions: [q({ note: 1 })] }), 'x.json'))
    expect(wrapped.warnings.filter((w) => w.code === 'unknownKey')).toHaveLength(3)
    const pkg = ok(await readPackage(fixture('01-package-ready.quiz.json'), 'a.quiz.json'))
    expect(pkg.warnings).toEqual([])
  })

  it('checks package parts', async () => {
    const base = JSON.parse(fixture('01-package-ready.quiz.json'))
    const variant = async (change: (p: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const copy = structuredClone(base)
      change(copy)
      return problems(await readPackage(JSON.stringify(copy), 'x.quiz.json'))
    }
    expect(await variant((p) => { p.format = 'other' })).toEqual(['Невідомий формат «other»: очікується quiz-package'])
    expect((await variant((p) => { p.format_version = 2 }))[0]).toMatch(/Оновіть застосунок/)
    expect(await variant((p) => { p.format_version = '1' })).toEqual(['format_version має бути 1'])
    expect((await variant((p) => { p.source.material_id = 'a b' }))[0]).toMatch(/material_id/)
    expect((await variant((p) => { p.source.part_id = '../x' }))[0]).toMatch(/part_id/)
    expect(await variant((p) => { delete p.source })).toContain('Фрагменти тексту потребують «source»')
    expect(await variant((p) => { p.fragments = {} })).toContain('«fragments» має бути масивом')
    expect((await variant((p) => { p.fragments[0] = { chapter: 'c' } }))[0]).toMatch(/Фрагмент 1: потрібен «id»/)
    expect((await variant((p) => { p.fragments[0].text = '' }))[0]).toMatch(/«text»/)
    expect((await variant((p) => { p.fragments[0].chapter = 1 }))[0]).toMatch(/chapter/)
    expect((await variant((p) => { p.fragments[0].start = -1 }))[0]).toMatch(/start/)
    expect((await variant((p) => { p.fragments[0].paragraph = 0 }))[0]).toMatch(/paragraph/)
    expect((await variant((p) => { p.course = { id: 'Bad Id', title: 'x' } }))[0]).toMatch(/course/)
    expect((await variant((p) => { p.producer = {} }))[0]).toMatch(/producer/)
    expect((await variant((p) => { p.questions[1].id = 'q1' }))[0]).toMatch(/id «q1» повторюється/)
    expect((await variant((p) => { p.questions[1].id = 7 }))[0]).toMatch(/«id» має бути рядком/)
    expect((await variant((p) => { p.questions[0].reviewed = 'yes' }))[0]).toMatch(/reviewed/)
    expect((await variant((p) => { p.questions[0].answer_fragment_ids = ['f1', 'f1'] }))[0]).toMatch(/різних id/)
  })

  it('reports damaged characters instead of hashing them', async () => {
    expect(problems(await readPackage(wrapper([q({ question: 'Broken \\ud800 text' })]).replace('\\\\ud800', '\\ud800'), 'x.json'))[0]).toMatch(/сурогатні/)
  })
})

describe('ids and states (F-03, F-04)', () => {
  it('derives the id from the material and part, or from the file name', async () => {
    const pkg = JSON.parse(fixture('01-package-ready.quiz.json'))
    expect(ok(await readPackage(JSON.stringify(pkg), 'any.quiz.json')).id).toBe('local-mat_689985a3039f')
    pkg.source.part_id = 'part-2'
    expect(ok(await readPackage(JSON.stringify(pkg), 'any.quiz.json')).id).toBe('local-mat_689985a3039f--part-2')
    expect(ok(await readPackage(fixture('04-creator-wrapper.json'), 'Downloads/English W15 (copy).json')).id).toBe('local-english-w15-copy')
  })

  it('makes safe slugs', () => {
    expect(slugOf('lekcja-6.quiz.json')).toBe('lekcja-6')
    expect(slugOf('Źdźbło Łąka.JSON')).toBe('zdzb-o-aka')
    expect(slugOf('Квіз.json')).toBe('quiz')
    expect(slugOf(`${'a'.repeat(70)}.json`)).toHaveLength(64)
  })

  it('gives a material no playable quiz and keeps question ids', async () => {
    const material = ok(await readPackage(fixture('02-package-material.quiz.json'), 'm.quiz.json'))
    expect([material.state, material.quiz]).toEqual(['material', null])
    const wrapped = ok(await readPackage(fixture('04-creator-wrapper.json'), 'w.json'))
    expect(wrapped.package.questions.map((x) => x.id)).toEqual(keys['04-creator-wrapper.json'].map((k) => `q-${k}`))
    expect(wrapped.package.questions.every((x) => x.reviewed)).toBe(true)
  })
})
