// Question keys and content hashes computed in the browser exactly as scripts/import_quizzes.py does (spec 002, F-05):
// SHA-256 of Python json.dumps(value, ensure_ascii=False, sort_keys=True), first 12 hex characters.
import type { Question, Quiz } from '../contracts.ts'

export type PyValue = string | number | boolean | null | PyValue[] | { [key: string]: PyValue }

/** True when a high surrogate has no low one after it or a low one has no high one before it (no lookbehind: Safari 16.0). */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}

/** Python sorts dict keys by code point; JS sort compares UTF-16 units, which differs above U+FFFF. */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!
    if (d !== 0) return d
  }
  return x.length - y.length
}

/**
 * Python `json.dumps(value, ensure_ascii=False, sort_keys=True)`. String escaping of JSON.stringify is the same
 * (", \\, \b \f \n \r \t, other C0 as lowercase \u00xx, U+2028/U+2029 raw). Hashed data holds no floats: a
 * non-integer number throws, because Python and JS print floats differently. A lone surrogate throws, as
 * Python cannot encode it to UTF-8.
 */
export function pyJson(value: PyValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`pyJson: only integers are supported, got ${value}`)
    return String(value)
  }
  if (typeof value === 'string') {
    if (hasLoneSurrogate(value)) throw new Error('pyJson: string has a lone surrogate')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(pyJson).join(', ')}]`
  const keys = Object.keys(value).sort(byCodePoint)
  return `{${keys.map((key) => `${pyJson(key)}: ${pyJson(value[key])}`).join(', ')}}`
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** `digest()` of import_quizzes.py. */
export async function digest(value: PyValue): Promise<string> {
  return (await sha256Hex(pyJson(value))).slice(0, 12)
}

/** FR-02: changes whenever the question text, its options or the correct index change. */
export function questionKey(q: Pick<Question, 'question' | 'options' | 'correct'>): Promise<string> {
  return digest([q.question, q.options, q.correct])
}

/** Hash of the normalized quiz without its own hash, as `load_quiz()` of import_quizzes.py. */
export function contentHash(quiz: Omit<Quiz, 'contentHash'>): Promise<string> {
  const { id, meta, strings, questions } = quiz
  return digest({ id, meta: { ...meta }, strings, questions: questions.map((q) => ({ ...q })) })
}
