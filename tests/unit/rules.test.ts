// Spec 002, T103: rules exported from Creator_quiz/tools/build_quiz.py behave in JS as in Python.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import rules from '../../src/core/generated/build-quiz-rules.json'

const root = resolve(__dirname, '../..')
const hasCreator = existsSync(resolve(root, '../Creator_quiz/tools/build_quiz.py'))

type Sample = { text: string; match?: boolean; group?: string | null; all?: string[] }
const regex = (name: string) => {
  const r = (rules.regex as Record<string, { source: string; flags: string }>)[name]
  return new RegExp(r.source, r.flags)
}

describe('build-quiz-rules.json', () => {
  it('compiles every regex and replays the Python samples', () => {
    const samples = rules.samples as Record<string, Sample[]>
    expect(Object.keys(samples).sort()).toEqual(Object.keys(rules.regex).sort())
    for (const [name, rows] of Object.entries(samples)) {
      const rx = regex(name)
      for (const row of rows) {
        const where = `${name}: ${JSON.stringify(row.text)}`
        if (name === 'stringVar') {
          expect(Array.from(row.text.matchAll(new RegExp(rx.source, rx.flags + 'g')), (m) => m[1]), where).toEqual(row.all)
        } else if (name === 'fence') {
          expect(rx.exec(row.text.trim())?.[1] ?? null, where).toBe(row.group)
        } else {
          expect(rx.test(row.text), where).toBe(row.match)
        }
      }
    }
  })

  it('checks the Cyrillic and Polish word boundaries that ASCII \\b would miss', () => {
    expect(regex('visual.uk').test('Що показано на схемі нижче?')).toBe(true)
    expect(regex('visual.uk').test('вна схемі')).toBe(false)
    expect(regex('visual.pl').test('linię ciągłą')).toBe(true)
  })

  it('has a complete preset of all string keys for uk, en and pl', () => {
    const keys = Object.keys(rules.stringKeys).sort()
    expect(keys).toHaveLength(30)
    expect(Object.keys(rules.presets).sort()).toEqual(['en', 'pl', 'uk'])
    for (const preset of Object.values(rules.presets)) expect(Object.keys(preset).sort()).toEqual(keys)
  })

  it('uses no lookbehind (Safari 16.0)', () => {
    for (const { source } of Object.values(rules.regex)) expect(source).not.toMatch(/\(\?<[=!]/)
  })
})

describe.skipIf(!hasCreator)('export_rules.py (needs ../Creator_quiz)', () => {
  it('reproduces the committed file from the current build_quiz.py', () => {
    const result = spawnSync('python3', [join(root, 'scripts/export_rules.py'), '--check'], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
