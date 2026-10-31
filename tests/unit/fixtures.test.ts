// Spec 002, T101: the schema copy equals Creator_quiz (constitution II, amendment 1) and the fixture set is complete.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const fixtures = join(root, 'tests/fixtures/quiz-package')
const schemaPath = 'schemas/quiz-package.v1.schema.json'
const creatorSchema = resolve(root, '../Creator_quiz', schemaPath)
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

interface Expected {
  app: 'accept' | 'reject'
  build_quiz: number
  state?: 'material' | 'draft' | 'ready'
  rule?: string
}

describe('quiz-package fixtures', () => {
  const expected = read<Record<string, Expected>>(join(fixtures, 'expected.json'))
  const keys = read<Record<string, string[]>>(join(fixtures, 'keys.json'))
  const files = readdirSync(fixtures).filter((f) => f.endsWith('.json') && f !== 'expected.json' && f !== 'keys.json').sort()

  it('lists every fixture in expected.json, at least 15', () => {
    expect(Object.keys(expected).sort()).toEqual(files)
    expect(files.length).toBeGreaterThanOrEqual(15)
  })

  it('gives every accepted fixture a state and every rejected one a rule', () => {
    for (const [name, entry] of Object.entries(expected)) {
      if (entry.app === 'accept') expect(entry.state, name).toMatch(/^(material|draft|ready)$/)
      else expect(entry.rule, name).toBeTruthy()
    }
  })

  it('has Python question keys for exactly the accepted fixtures', () => {
    const accepted = Object.keys(expected).filter((name) => expected[name].app === 'accept').sort()
    expect(Object.keys(keys).sort()).toEqual(accepted)
    for (const list of Object.values(keys)) for (const key of list) expect(key).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe.skipIf(!existsSync(creatorSchema))('schema copy (needs ../Creator_quiz)', () => {
  it('is byte-identical to Creator_quiz/schemas', () => {
    expect(readFileSync(join(root, schemaPath), 'utf8')).toBe(readFileSync(creatorSchema, 'utf8'))
  })
})
