// Spec 002, T111 (FR-63, FR-82, FR-83, FR-86, FR-87, SC-17): editor logic without UI.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PackageQuestion, QuizPackage } from '../../src/contracts.ts'
import {
  addQuestion, blockers, newId, buildPrompt, chapters, deleteQuestion, editQuestion, markReviewed, MAX_PROMPT_CHARS, moveQuestion,
  parseReply, questionProblems, reviewProblems, rotateCorrect,
} from '../../src/core/editor.ts'
import { readPackage } from '../../src/core/package.ts'

const fixtures = resolve(__dirname, '../fixtures/quiz-package')
const material = JSON.parse(readFileSync(join(fixtures, '02-package-material.quiz.json'), 'utf8')) as QuizPackage
const ids = () => { let n = 0; return () => `id${++n}` }

const good = (over: Partial<PackageQuestion> = {}): Partial<PackageQuestion> => ({
  question: 'O czym jest lekcja?', options: ['Edukacja', 'Podróże', 'Zakupy'], correct: 0, feedback: 'Lekcja mówi o edukacji.',
  answer_fragment_ids: ['f1'], feedback_fragment_ids: ['f1'], ...over,
})

function withGood(count: number, corrects: number[] = [0, 1, 2]): QuizPackage {
  let pkg = material
  for (let i = 0; i < count; i++) {
    pkg = addQuestion(pkg, `q${i}`)
    pkg = editQuestion(pkg, `q${i}`, good({ title: `T${i}`, question: `Pytanie ${i}?`, correct: corrects[i % corrects.length] }))
  }
  return pkg
}

describe('a question (questionProblems, quiz.py)', () => {
  it('makes question ids like the converter (q + 32 hex)', () => {
    expect(newId()).toMatch(/^q[0-9a-f]{32}$/)
    expect(newId()).not.toBe(newId())
  })

  it('starts empty in the language of the quiz and is not changed in place', () => {
    const pkg = addQuestion(material, 'q1')
    expect(material.questions).toEqual([])
    expect(pkg.questions[0]).toEqual({ id: 'q1', title: 'Nowe pytanie', question: '', options: ['', '', ''], correct: 0, feedback: '', answer_fragment_ids: [], feedback_fragment_ids: [], reviewed: false })
    expect(questionProblems(pkg, pkg.questions[0], { reviewed: false })).toEqual([
      'заповніть назву, питання та пояснення', 'варіанти мають бути непорожніми й різними', 'виберіть уривок, на який спирається відповідь',
    ])
  })

  it('accepts a complete question and asks only for the review', () => {
    const pkg = withGood(1)
    expect(questionProblems(pkg, pkg.questions[0], { reviewed: false })).toEqual([])
    expect(questionProblems(pkg, pkg.questions[0])).toEqual(['питання не переглянуто'])
  })

  it('checks options, labels, the correct index, lengths and references', () => {
    const pkg = withGood(1)
    const problems = (over: Partial<PackageQuestion>) => questionProblems(pkg, { ...pkg.questions[0], ...over }, { reviewed: false })
    expect(problems({ options: ['A', 'B'] })).toEqual(['потрібно від 3 до 6 варіантів'])
    expect(problems({ options: ['1', '2', '3', '4', '5', '6', '7'] })).toEqual(['потрібно від 3 до 6 варіантів'])
    expect(problems({ options: ['Ala', ' ala ', 'Ola'] })).toEqual(['варіанти мають бути непорожніми й різними'])
    expect(problems({ options: ['A. Ala', 'Ola', 'Ela'] })).toEqual(['приберіть літерні мітки з варіантів'])
    expect(problems({ options: ['Б) Ала', 'Оля', 'Еля'] })).toEqual(['приберіть літерні мітки з варіантів'])
    expect(problems({ correct: 3 })).toEqual(['позначте правильну відповідь'])
    expect(problems({ title: 'x'.repeat(201) })[0]).toMatch(/скоротіть текст/)
    expect(problems({ options: ['x'.repeat(1001), 'b', 'c'] })).toEqual(['скоротіть варіант до 1000 символів'])
    expect(problems({ answer_fragment_ids: [] })).toEqual(['виберіть уривок, на який спирається відповідь'])
    expect(problems({ feedback_fragment_ids: ['f9'] })).toEqual(['опора посилається на уривок, якого немає в матеріалі'])
  })

  it('does not ask for references when the file has no text fragments', () => {
    const plain = addQuestion({ ...material, fragments: undefined, source: undefined }, 'q1')
    const pkg = editQuestion(plain, 'q1', good({ answer_fragment_ids: [], feedback_fragment_ids: [] }))
    expect(questionProblems(pkg, pkg.questions[0], { reviewed: false })).toEqual([])
  })
})

describe('changes and review marks (FR-83)', () => {
  it('takes the mark off on any content change and ignores an equal patch', () => {
    let pkg = withGood(1)
    const marked = markReviewed(pkg, 'q0')
    expect(marked.ok).toBe(true)
    if (marked.ok) pkg = marked.pkg
    expect(pkg.questions[0].reviewed).toBe(true)
    expect(editQuestion(pkg, 'q0', { title: 'T0' })).toBe(pkg)
    expect(editQuestion(pkg, 'q0', { feedback: 'Inne wyjaśnienie.' }).questions[0].reviewed).toBe(false)
    expect(editQuestion(pkg, 'q0', { feedback_fragment_ids: ['f2'] }).questions[0].reviewed).toBe(false)
  })

  it('refuses a mark while a problem is left, including the same correct position everywhere and a repeat', () => {
    expect(markReviewed(addQuestion(material, 'q1'), 'q1')).toEqual({ ok: false, problems: expect.arrayContaining(['Nowe pytanie: заповніть назву, питання та пояснення']) })
    const same = withGood(2, [0])
    expect(reviewProblems(same, 'q0')).toEqual(['правильна відповідь стоїть на однаковому місці в усіх питаннях: змініть порядок варіантів'])
    const fixed = editQuestion(same, 'q1', { options: ['Podróże', 'Edukacja', 'Zakupy'], correct: 1 })
    const all = markReviewed(fixed)
    expect(all.ok && all.pkg.questions.every((q) => q.reviewed)).toBe(true)
    const repeated = editQuestion(fixed, 'q1', { question: 'pytanie 0? ' })
    expect(reviewProblems(repeated, 'q1')).toContain('питання повторюється')
  })

  it('lists blockers of the set with question numbers', () => {
    expect(blockers(material)).toEqual(['Додайте хоча б одне питання.'])
    const pkg = withGood(3)
    expect(blockers(pkg)).toEqual(['1. питання не переглянуто', '2. питання не переглянуто', '3. питання не переглянуто'])
    const marked = markReviewed(pkg)
    expect(marked.ok && blockers(marked.pkg)).toEqual([])
    const same = withGood(2, [1])
    expect(blockers(same).at(-1)).toMatch(/однаковому місці/)
    expect(blockers(editQuestion(same, 'q1', { question: 'Pytanie 0?' }))).toContain('2. питання повторюється')
  })

  it('deletes and moves questions', () => {
    const pkg = withGood(3)
    expect(deleteQuestion(pkg, 'q1').questions.map((q) => q.id)).toEqual(['q0', 'q2'])
    expect(moveQuestion(pkg, 'q2', -1).questions.map((q) => q.id)).toEqual(['q0', 'q2', 'q1'])
    expect(moveQuestion(pkg, 'q0', -1)).toBe(pkg)
    expect(() => deleteQuestion(pkg, 'nope')).toThrow(/не знайдено/)
  })

  it('a reviewed set reads back as a ready quiz', async () => {
    const marked = markReviewed(withGood(3))
    if (!marked.ok) throw new Error(marked.problems.join())
    const result = await readPackage(JSON.stringify(marked.pkg), 'lekcja.quiz.json')
    expect(result.ok && result.state).toBe('ready')
  })
})

describe('rotateCorrect (quiz.py)', () => {
  it('moves the correct option of question i to position i % 3 and keeps it correct', () => {
    const qs = withGood(4, [0]).questions
    const rotated = rotateCorrect(qs)
    expect(rotated.map((q) => q.correct)).toEqual([0, 1, 2, 0])
    rotated.forEach((q) => expect(q.options[q.correct]).toBe('Edukacja'))
    expect(rotateCorrect(qs, 1).map((q) => q.correct)).toEqual([1, 2, 0, 1])
  })
})

describe('prompt for an external model (FR-86)', () => {
  it('lists chapters and builds the prompt with the chosen fragments only', () => {
    expect(chapters(material)).toEqual([{ title: 'Część pierwsza. Nowe słowa.', chars: 116 }])
    const prompt = buildPrompt(material, { count: 4 })
    if (!prompt.ok) throw new Error(prompt.problem)
    expect(prompt.chars).toBe(116)
    expect(prompt.text).toContain('Write 4 questions in the language «pl»')
    expect(prompt.text).toContain('untrusted source content')
    expect(prompt.text).toContain('"id": "f2"')
    expect(buildPrompt(material, { chosen: ['Other'] })).toEqual({ ok: false, problem: 'У вибраних розділах немає тексту' })
    expect(buildPrompt(material, { count: 0 }).ok).toBe(false)
  })

  it('refuses more than 60 000 characters', () => {
    const big = { ...material, fragments: [1, 2, 3, 4].map((n) => ({ id: `f${n}`, chapter: 'C', text: 'x'.repeat(16_000) })) }
    expect(buildPrompt(big)).toEqual({ ok: false, problem: `Вибрано 64000 символів тексту, допустимо до ${MAX_PROMPT_CHARS}. Оберіть менше розділів.` })
  })
})

describe('reading the reply (FR-87)', () => {
  const reply = (questions: unknown[], warning = '') => '```json\n' + JSON.stringify({ questions, warning }) + '\n```'
  const q = (n: number, over: object = {}) => ({
    title: `Pytanie ${n}`, question: `Co mówi zdanie ${n}?`, options: [`Prawda ${n}`, `Fałsz ${n}`, `Nie wiadomo ${n}`], correct: 0,
    feedback: `Zdanie ${n}.`, answer_fragment_ids: ['f1'], feedback_fragment_ids: ['f2'], ...over,
  })

  it('SC-17: one question with an unknown fragment is reported, the rest are added as not reviewed', async () => {
    const start = withGood(1)
    const result = await parseReply(start, reply([q(1), q(2), q(3, { answer_fragment_ids: ['f9'] }), q(4), q(5)], 'Mało tekstu.'), ids())
    expect(result.problems).toEqual(['Питання 3 відповіді: уривків f9 немає в матеріалі'])
    expect(result.added).toBe(4)
    expect(result.warning).toBe('Mało tekstu.')
    expect(result.pkg.questions[0]).toBe(start.questions[0])
    const added = result.pkg.questions.slice(1)
    expect(added.map((x) => [x.id, x.reviewed, x.correct])).toEqual([['id1', false, 1], ['id2', false, 2], ['id3', false, 0], ['id4', false, 1]])
    added.forEach((x, i) => expect(x.options[x.correct]).toBe(`Prawda ${[1, 2, 4, 5][i]}`))
    expect(start.questions).toHaveLength(1)
  })

  it('reports invalid replies and skips repeats of existing questions', async () => {
    const start = withGood(1)
    expect((await parseReply(start, 'Sorry, I cannot.')).problems[0]).toMatch(/^Відповідь не є JSON/)
    expect((await parseReply(start, '{"items": []}')).problems).toEqual(['У відповіді немає масиву «questions»'])
    const dup = { ...q(1), question: 'Pytanie 0?', options: ['Edukacja', 'Podróże', 'Zakupy'] }
    const result = await parseReply(start, JSON.stringify([dup, q(2, { options: ['a', 'a', 'b'] }), q(3, { correct: 1.0 }), 7, q(4, { title: '' })]), ids())
    expect(result.problems).toEqual([
      'Питання 1 відповіді: повторює наявне питання',
      'Питання 2 відповіді: однакові варіанти',
      "Питання 4 відповіді: має бути об'єктом",
      'Питання 5 відповіді: «title» має бути непорожнім рядком',
    ])
    expect(result.added).toBe(1)
    expect((await parseReply(start, JSON.stringify([q(9, { answer_fragment_ids: 'f1' })]))).problems).toEqual(['Питання 1 відповіді: «answer_fragment_ids» має бути списком id уривків'])
    expect((await parseReply(start, JSON.stringify([q(9, { correct: 2.5 })]))).problems).toEqual(['Питання 1 відповіді: «correct» має бути номером варіанта від 0'])
  })

  it('stops at 200 questions', async () => {
    let pkg = material
    for (let i = 0; i < 199; i++) pkg = { ...pkg, questions: [...pkg.questions, { id: `x${i}`, title: 't', question: `q${i}`, options: ['a', 'b', 'c'], correct: 0, feedback: 'f', reviewed: false }] }
    const result = await parseReply(pkg, JSON.stringify([q(1), q(2)]), ids())
    expect([result.added, result.problems]).toEqual([1, ['Додано лише 1 питань: у квізі може бути до 200']])
  })
})
