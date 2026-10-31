// Quiz files from disk (spec 002, F-01…F-06, FR-61…FR-63, FR-69): reading, checks and normalization.
// Hard checks repeat Creator_quiz/tools/build_quiz.py (rules in generated/build-quiz-rules.json); the app is stricter
// only where expected.json of the shared fixtures records a rule (F-01, F-06, fragment references, repeated question).
import type {
  Fragment, PackageQuestion, PackageSource, PackageState, PackageWarning, Question, Quiz, QuizMeta, QuizPackage,
  ReadResult, WarningCode,
} from '../contracts.ts'
import { contentHash, questionKey } from './canonical.ts'
import {
  invisibleChars, limits, metaKeys, presets, questionKeys, regex, rtlLangs, stringKeys, wrapperKeys,
} from './generated/build-quiz-rules.json'

export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_QUESTIONS = 200
export const MAX_OPTIONS = 6
const MIN_OPTIONS = 3
const MAX_PROBLEMS = 30
const TEXT_LIMITS = { title: 200, question: 2000, option: 1000, feedback: 4000, fragment: 20000, chapter: 300 }
const PACKAGE_KEYS = new Set([...wrapperKeys, 'format', 'format_version', 'course', 'producer', 'source', 'fragments'])
const PACKAGE_QUESTION_KEYS = new Set([...questionKeys, 'id', 'reviewed', 'answer_fragment_ids', 'feedback_fragment_ids'])
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
const COURSE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

const rx = (name: keyof typeof regex, extra = '') => new RegExp(regex[name].source, regex[name].flags + extra)
const LANG_RE = rx('lang')
const OPTION_LABEL_RE = rx('optionLabel')
const CITATION_RE = rx('citation')
const FENCE_RE = rx('fence')
const STRING_VAR_RE = rx('stringVar', 'g')
const VISUAL_RE: Record<string, RegExp> = { uk: rx('visual.uk'), en: rx('visual.en'), pl: rx('visual.pl') }
const INVISIBLE_RE = new RegExp(`[${invisibleChars.join('')}]`, 'gu')

/** A JSON number written with a fraction or exponent: Python reads it as float, so it is never an integer. */
export class PyFloat {
  constructor(readonly value: number) {}
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof PyFloat)
/** Python `isinstance(v, int)` without bool: JSON integers only, never 1.0. */
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isNonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const codePoints = (s: string) => Array.from(s).length
const short = (s: string) => Array.from(s.trim()).slice(0, 40).join('')

// --- Reading -----------------------------------------------------------------------------------------------------

/** `read_json_file` of build_quiz.py: UTF-8, invisible characters, a Markdown fence, NBSP outside strings. */
export function decodeUtf8(bytes: ArrayBuffer): { ok: true; text: string } | { ok: false; problem: string } {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, problem: 'Файл не в кодуванні UTF-8' }
  }
}

/** Calls `visit(index)` for every character outside JSON strings. */
function outsideStrings(text: string, visit: (index: number) => number | void) {
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else {
      const skip = visit(i)
      if (typeof skip === 'number') i = skip - 1
    }
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y

/** JSON.parse that keeps Python's int/float distinction: `1.0` becomes a PyFloat, `1` stays a number. */
function parsePyJson(text: string): unknown {
  const marker = `\\u0000f${Math.random().toString(36).slice(2)}`
  const key = JSON.parse(`"${marker}"`) as string
  let out = ''
  let last = 0
  outsideStrings(text, (i) => {
    const ch = text[i]
    if (ch !== '-' && (ch < '0' || ch > '9')) return
    NUMBER.lastIndex = i
    const m = NUMBER.exec(text)
    if (!m) return
    const end = i + m[0].length
    if (m[1] !== undefined || m[2] !== undefined) {
      out += `${text.slice(last, i)}{"${marker}":${m[0]}}`
      last = end
    }
    return end
  })
  const revive = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(revive)
    if (value && typeof value === 'object') {
      const keys = Object.keys(value)
      if (keys.length === 1 && keys[0] === key) return new PyFloat((value as Obj)[key] as number)
      for (const k of keys) (value as Obj)[k] = revive((value as Obj)[k])
    }
    return value
  }
  return revive(JSON.parse(out + text.slice(last)))
}

function nbspOutsideStringsToSpace(text: string): string {
  const chars = text.split('')
  outsideStrings(text, (i) => {
    if (chars[i] === ' ') chars[i] = ' '
  })
  return chars.join('')
}

function readJson(raw: string, warn: (code: WarningCode, message: string) => void): { ok: true; data: unknown } | { ok: false; problem: string } {
  let removed = 0
  const text = raw.replace(INVISIBLE_RE, () => {
    removed++
    return ''
  })
  if (removed) warn('invisible', `Прибрано невидимих символів (U+200B, U+2060, U+FEFF): ${removed}`)
  let stripped = text.trim()
  const fence = FENCE_RE.exec(stripped)
  if (fence) stripped = fence[1]
  try {
    return { ok: true, data: parsePyJson(stripped) }
  } catch (error) {
    if (stripped.includes(' ')) {
      try {
        const data = parsePyJson(nbspOutsideStringsToSpace(stripped))
        warn('nbsp', 'Нерозривні пробіли (U+00A0) поза рядками JSON замінено звичайними')
        return { ok: true, data }
      } catch {
        // fall through to the original error
      }
    }
    return { ok: false, problem: `Файл не є JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// --- Checks --------------------------------------------------------------------------------------------------------

function questionWhere(index: number, item: unknown) {
  const title = isObj(item) && isNonEmptyStr(item.title) ? ` («${short(item.title)}»)` : ''
  return `Питання ${index + 1}${title}`
}

function checkText(problems: string[], where: string, field: string, value: unknown, max: number) {
  if (value === undefined) problems.push(`${where}: немає «${field}»`)
  else if (!isNonEmptyStr(value)) problems.push(`${where}: «${field}» має бути непорожнім рядком`)
  else if (codePoints(value) > max) problems.push(`${where}: «${field}» довший за ${max} символів`)
}

/** `validate_questions` of build_quiz.py plus F-06 limits; `knownKeys` decides which extra keys warn. */
function checkQuestions(items: unknown[], problems: string[], warn: (code: WarningCode, m: string) => void, knownKeys: Set<string>) {
  items.forEach((item, index) => {
    const where = questionWhere(index, item)
    if (!isObj(item)) {
      problems.push(`${questionWhere(index, null)}: має бути об'єктом`)
      return
    }
    checkText(problems, where, 'title', item.title, TEXT_LIMITS.title)
    checkText(problems, where, 'question', item.question, TEXT_LIMITS.question)
    checkText(problems, where, 'feedback', item.feedback, TEXT_LIMITS.feedback)
    const options = item.options
    let optionsOk = false
    if (options === undefined) problems.push(`${where}: немає «options»`)
    else if (!Array.isArray(options)) problems.push(`${where}: «options» має бути масивом`)
    else {
      if (options.length < MIN_OPTIONS) problems.push(`${where}: потрібно щонайменше ${MIN_OPTIONS} варіанти, є ${options.length}`)
      if (options.length > MAX_OPTIONS) problems.push(`${where}: не більше ${MAX_OPTIONS} варіантів, є ${options.length}`)
      const bad = options.flatMap((o, i) => (isNonEmptyStr(o) ? [] : [i + 1]))
      if (bad.length) problems.push(`${where}: варіанти ${bad.join(', ')} мають бути непорожніми рядками`)
      else {
        const seen = new Map<string, number>()
        for (const o of options as string[]) seen.set(o.trim(), (seen.get(o.trim()) ?? 0) + 1)
        const dups = [...seen].filter(([, n]) => n > 1).map(([o]) => `«${short(o)}»`)
        if (dups.length) problems.push(`${where}: однакові варіанти ${dups.join(', ')}`)
        const long = (options as string[]).findIndex((o) => codePoints(o) > TEXT_LIMITS.option)
        if (long >= 0) problems.push(`${where}: варіант ${long + 1} довший за ${TEXT_LIMITS.option} символів`)
        optionsOk = options.length >= MIN_OPTIONS && !dups.length
      }
    }
    const correct = item.correct
    if (correct === undefined) problems.push(`${where}: немає «correct»`)
    else if (!isInt(correct)) problems.push(`${where}: «correct» має бути цілим числом, а не ${correct instanceof PyFloat ? correct.value.toFixed(1) : JSON.stringify(correct)}`)
    else if (Array.isArray(options) && !(correct >= 0 && correct < options.length)) {
      problems.push(`${where}: «correct» = ${correct}, а має бути від 0 до ${options.length - 1}`)
    }
    if (optionsOk && (options as string[]).some((o) => OPTION_LABEL_RE.test(o))) {
      warn('optionLabel', `${where}: варіант починається з літерної мітки на кшталт «A.» чи «B)»`)
    }
    const unknown = Object.keys(item).filter((k) => !knownKeys.has(k)).sort()
    if (unknown.length) warn('unknownKey', `${where}: невідомі поля пропущено: ${unknown.join(', ')}`)
  })
}

/** `resolve_meta` of build_quiz.py. */
function resolveMeta(meta: Obj, problems: string[]): QuizMeta | null {
  const before = problems.length
  for (const key of ['title', 'description', 'lang', 'dir']) {
    if (key in meta && typeof meta[key] !== 'string') problems.push(`meta.${key} має бути рядком`)
  }
  if (problems.length > before) return null
  const lang = meta.lang as string | undefined
  const title = meta.title as string | undefined
  const dir = meta.dir as string | undefined
  if (!isNonEmptyStr(lang)) problems.push('Немає мови квізу: задайте meta.lang')
  else if (!LANG_RE.test(lang.trim())) problems.push(`Мова «${lang}» не є тегом BCP 47 на кшталт uk, en, pl, pt-BR`)
  if (!isNonEmptyStr(title)) problems.push('Немає назви квізу: задайте meta.title')
  else if (codePoints(title.trim()) > TEXT_LIMITS.title) problems.push(`Назва квізу довша за ${TEXT_LIMITS.title} символів`)
  if (dir !== undefined && dir !== 'ltr' && dir !== 'rtl') problems.push(`Напрям тексту має бути ltr або rtl, а не «${dir}»`)
  if (problems.length > before) return null
  const resolvedLang = lang!.trim()
  const primary = resolvedLang.split('-')[0].toLowerCase()
  return {
    lang: resolvedLang,
    dir: (dir as QuizMeta['dir'] | undefined) ?? (rtlLangs.includes(primary) ? 'rtl' : 'ltr'),
    title: title!.trim(),
    description: ((meta.description as string | undefined) ?? '').trim(),
  }
}

/** `resolve_strings` of build_quiz.py: preset of the language, then the file's strings. */
function resolveStrings(lang: string, fileStrings: Obj, problems: string[], warn: (code: WarningCode, m: string) => void): Record<string, string> | null {
  const all = presets as Record<string, Record<string, string>>
  const merged: Record<string, string> = { ...(all[lang.toLowerCase()] ?? all[lang.split('-')[0].toLowerCase()] ?? {}) }
  const before = problems.length
  for (const [key, value] of Object.entries(fileStrings)) {
    if (!(key in stringKeys)) warn('unknownStringKey', `strings: невідомий ключ пропущено: ${key}`)
    else if (!isNonEmptyStr(value)) problems.push(`strings.${key} має бути непорожнім рядком`)
    else merged[key] = value
  }
  const missing = Object.keys(stringKeys).filter((key) => !(key in merged))
  if (missing.length) {
    problems.push(`Немає повного набору рядків інтерфейсу для мови «${lang}» (вбудовані: ${Object.keys(all).sort().join(', ')}); бракує: ${missing.join(', ')}. Додайте їх в об'єкт «strings»`)
  }
  if (problems.length > before) return null
  const result: Record<string, string> = {}
  for (const [key, allowed] of Object.entries(stringKeys as Record<string, string[]>)) {
    const vars = [...merged[key].matchAll(STRING_VAR_RE)].map((m) => m[1]).filter((v) => !allowed.includes(v))
    if (vars.length) warn('unknownPlaceholder', `Рядок «${key}» має невідомі підстановки: ${[...new Set(vars)].sort().join(', ')}`)
    result[key] = merged[key]
  }
  return result
}

/** `question_warnings` and `content_warnings` of build_quiz.py, without the «not 10 questions» note. */
function contentWarnings(questions: PackageQuestion[], lang: string, warn: (code: WarningCode, m: string) => void) {
  if (questions.length > 1 && new Set(questions.map((q) => q.correct)).size === 1) {
    warn('sameCorrect', `У всіх питаннях правильна відповідь на позиції ${questions[0].correct + 1}`)
  }
  const titles = new Map<string, number>()
  for (const q of questions) titles.set(q.title.trim(), (titles.get(q.title.trim()) ?? 0) + 1)
  const dupTitles = [...titles].filter(([, n]) => n > 1).map(([t]) => `«${t}»`)
  if (dupTitles.length) warn('duplicateTitles', `Однакові назви питань: ${dupTitles.join(', ')}`)
  const visual = VISUAL_RE[lang.split('-')[0].toLowerCase()]
  const longestCorrect: number[] = []
  questions.forEach((q, index) => {
    const where = questionWhere(index, q)
    const texts = [q.title, q.question, ...q.options, q.feedback]
    if (texts.some((t) => CITATION_RE.test(t))) warn('citation', `${where}: позначка посилання на кшталт [1] у тексті`)
    if (visual && texts.some((t) => visual.test(t))) warn('visualRef', `${where}: посилається на малюнок, схему чи лінію, яких учень не бачить`)
    const lengths = q.options.map((o) => codePoints(o.trim()))
    const max = Math.max(...lengths)
    const min = Math.min(...lengths)
    if (max >= limits.optionLengthMin && max / min > limits.optionLengthRatio) {
      warn('optionLength', `${where}: найдовший варіант у ${(max / min).toFixed(1)} раза довший за найкоротший`)
    }
    if (lengths.every((n, i) => i === q.correct || lengths[q.correct] > n)) longestCorrect.push(index)
  })
  if (questions.length >= 6 && longestCorrect.length > limits.longestCorrectShare * questions.length) {
    warn('longestCorrect', `Правильна відповідь найдовша в ${longestCorrect.length} з ${questions.length} питань (${longestCorrect.map((i) => i + 1).join(', ')}): її можна вгадати за довжиною`)
  }
}

function checkStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 64) && new Set(value).size === value.length
}

/** Package-only parts: format, source, fragments, course, producer and the question fields of the converter. */
function checkPackage(data: Obj, problems: string[]): { fragments: Fragment[]; source?: PackageSource } {
  if (data.format !== 'quiz-package') {
    problems.push(`Невідомий формат «${String(data.format)}»: очікується quiz-package`)
  } else if (isInt(data.format_version) && data.format_version > 1) {
    problems.push(`Формат новіший за застосунок (format_version ${data.format_version}). Оновіть застосунок.`)
  } else if (data.format_version !== 1) {
    problems.push('format_version має бути 1')
  }
  let source: PackageSource | undefined
  if (data.source !== undefined) {
    if (!isObj(data.source) || typeof data.source.material_id !== 'string' || !SAFE_ID.test(data.source.material_id)) {
      problems.push('source.material_id має бути ідентифікатором з літер, цифр, «_» чи «-» до 64 символів')
    } else if (data.source.part_id != null && (typeof data.source.part_id !== 'string' || !SAFE_ID.test(data.source.part_id))) {
      problems.push('source.part_id має бути ідентифікатором з літер, цифр, «_» чи «-» до 64 символів')
    } else source = data.source as PackageSource
  }
  const fragments: Fragment[] = []
  if (data.fragments !== undefined) {
    if (data.source === undefined) problems.push('Фрагменти тексту потребують «source»')
    if (!Array.isArray(data.fragments)) problems.push('«fragments» має бути масивом')
    else {
      const ids = new Set<string>()
      data.fragments.forEach((f, i) => {
        const where = `Фрагмент ${i + 1}`
        if (!isObj(f) || typeof f.id !== 'string' || !f.id || f.id.length > 64) {
          problems.push(`${where}: потрібен «id» — рядок до 64 символів`)
          return
        }
        if (ids.has(f.id)) problems.push(`${where}: id «${f.id}» повторюється`)
        ids.add(f.id)
        if (typeof f.chapter !== 'string' || codePoints(f.chapter) > TEXT_LIMITS.chapter) problems.push(`${where}: «chapter» має бути рядком до ${TEXT_LIMITS.chapter} символів`)
        checkText(problems, where, 'text', f.text, TEXT_LIMITS.fragment)
        const num = (v: unknown) => v == null || (v instanceof PyFloat ? v.value >= 0 : typeof v === 'number' && v >= 0)
        if (!num(f.start) || !num(f.end)) problems.push(`${where}: «start» і «end» мають бути невід'ємними числами`)
        if (f.paragraph != null && !(isInt(f.paragraph) && f.paragraph >= 1)) problems.push(`${where}: «paragraph» має бути цілим ≥ 1`)
        const plain = (v: unknown) => (v instanceof PyFloat ? v.value : (v as number | null | undefined))
        fragments.push({ id: f.id, chapter: f.chapter as string, paragraph: f.paragraph as number | null | undefined, text: f.text as string, start: plain(f.start), end: plain(f.end) })
      })
    }
  }
  if (data.course !== undefined && !(isObj(data.course) && typeof data.course.id === 'string' && COURSE_ID.test(data.course.id) && isNonEmptyStr(data.course.title) && codePoints(data.course.title) <= 120)) {
    problems.push('course: потрібні «id» (малі латинські літери, цифри, «-») і непорожня назва до 120 символів')
  }
  if (data.producer !== undefined && !(isObj(data.producer) && isNonEmptyStr(data.producer.app))) problems.push('producer: потрібне непорожнє «app»')
  const known = new Set(fragments.map((f) => f.id))
  const questionIds = new Set<string>()
  ;(Array.isArray(data.questions) ? data.questions : []).forEach((q, index) => {
    if (!isObj(q)) return
    const where = questionWhere(index, q)
    if (q.id !== undefined) {
      if (typeof q.id !== 'string' || !q.id || q.id.length > 64) problems.push(`${where}: «id» має бути рядком до 64 символів`)
      else if (questionIds.has(q.id)) problems.push(`${where}: id «${q.id}» повторюється`)
      else questionIds.add(q.id)
    }
    if (q.reviewed !== undefined && typeof q.reviewed !== 'boolean') problems.push(`${where}: «reviewed» має бути true або false`)
    for (const field of ['answer_fragment_ids', 'feedback_fragment_ids']) {
      if (q[field] === undefined) continue
      if (!checkStringList(q[field])) problems.push(`${where}: «${field}» має бути списком різних id фрагментів`)
      else {
        const missing = (q[field] as string[]).filter((id) => !known.has(id))
        if (missing.length) problems.push(`${where}: «${field}» посилається на неіснуючі фрагменти ${missing.join(', ')}`)
      }
    }
  })
  return { fragments, source }
}

// --- Normalization -------------------------------------------------------------------------------------------------

/** F-04: id of a quiz from disk. */
export function quizIdFor(source: PackageSource | undefined, fileSlug: string): string {
  if (source) return `local-${source.material_id}${source.part_id ? `--${source.part_id}` : ''}`
  return `local-${fileSlug}`
}

export function slugOf(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.quiz\.json$/i, '').replace(/\.json$/i, '')
  const slug = base.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')
  return slug || 'quiz'
}

/** The normalized quiz of import_quizzes.py: question keys and the content hash. */
export async function buildQuiz(id: string, meta: QuizMeta, strings: Record<string, string>, questions: PackageQuestion[]): Promise<Quiz> {
  const items: Question[] = []
  for (const q of questions) {
    items.push({ key: await questionKey(q), title: q.title, question: q.question, options: q.options, correct: q.correct, feedback: q.feedback })
  }
  const body = { id, meta, strings, questions: items }
  return { ...body, contentHash: await contentHash(body) }
}

function stateOf(questions: PackageQuestion[]): PackageState {
  if (!questions.length) return 'material'
  return questions.every((q) => q.reviewed) ? 'ready' : 'draft'
}

function limitProblems(problems: string[]): string[] {
  return problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), `… і ще ${problems.length - MAX_PROBLEMS}`] : problems
}

/**
 * Reads a quiz file: a quiz-package v1 or a Creator_quiz wrapper `{meta, strings?, questions}`. Nothing is stored;
 * the caller saves `package` and `quiz` only after the person confirms (FR-64).
 */
export async function readPackage(text: string, fileName: string, bytes = new TextEncoder().encode(text).length): Promise<ReadResult> {
  if (bytes > MAX_FILE_BYTES) {
    return { ok: false, problems: [`Файл завеликий: ${Math.ceil(bytes / 1024)} КБ, допустимо до ${MAX_FILE_BYTES / 1024 / 1024} МБ`] }
  }
  const warnings: PackageWarning[] = []
  const warn = (code: WarningCode, message: string) => warnings.push({ code, message })
  const read = readJson(text, warn)
  if (!read.ok) return { ok: false, problems: [read.problem] }
  const data = read.data
  if (Array.isArray(data)) return { ok: false, problems: ['Файл містить лише масив питань без «meta»: застосунку потрібні назва й мова квізу'] }
  if (!isObj(data)) return { ok: false, problems: ['Файл має містити об\'єкт з «meta» і «questions»'] }

  const problems: string[] = []
  const isPackage = 'format' in data || 'format_version' in data
  const unknownTop = Object.keys(data).filter((k) => !(isPackage ? PACKAGE_KEYS : new Set(wrapperKeys)).has(k)).sort()
  if (unknownTop.length) warn('unknownKey', `Невідомі поля пропущено: ${unknownTop.join(', ')}`)
  const meta = data.meta === undefined ? {} : data.meta
  const strings = data.strings === undefined ? {} : data.strings
  if (!isObj(meta)) problems.push('«meta» має бути об\'єктом')
  if (!isObj(strings)) problems.push('«strings» має бути об\'єктом')
  const pkg = isPackage ? checkPackage(data, problems) : { fragments: [] as Fragment[], source: undefined }
  if (!('questions' in data)) problems.push('Немає масиву «questions»')
  else if (!Array.isArray(data.questions)) problems.push('«questions» має бути масивом')
  else if (!data.questions.length && !isPackage) problems.push('Масив «questions» порожній')
  else if (data.questions.length > MAX_QUESTIONS) problems.push(`Забагато питань: ${data.questions.length}, допустимо до ${MAX_QUESTIONS}`)
  else checkQuestions(data.questions, problems, warn, isPackage ? PACKAGE_QUESTION_KEYS : new Set(questionKeys))
  if (problems.length) return { ok: false, problems: limitProblems(problems) }

  const metaObj = meta as Obj
  const unknownMeta = Object.keys(metaObj).filter((k) => !metaKeys.includes(k)).sort()
  if (unknownMeta.length) warn('unknownKey', `meta: невідомі поля пропущено: ${unknownMeta.join(', ')}`)
  const resolvedMeta = resolveMeta(metaObj, problems)
  const resolvedStrings = resolvedMeta ? resolveStrings(resolvedMeta.lang, strings as Obj, problems, warn) : null
  if (!resolvedMeta || !resolvedStrings) return { ok: false, problems: limitProblems(problems) }

  const raw = data.questions as Obj[]
  const questions: PackageQuestion[] = []
  for (const q of raw) {
    const item: PackageQuestion = {
      id: '', title: q.title as string, question: q.question as string, options: q.options as string[],
      correct: q.correct as number, feedback: q.feedback as string, reviewed: (q.reviewed as boolean | undefined) ?? true,
    }
    if (q.answer_fragment_ids !== undefined) item.answer_fragment_ids = q.answer_fragment_ids as string[]
    if (q.feedback_fragment_ids !== undefined) item.feedback_fragment_ids = q.feedback_fragment_ids as string[]
    questions.push(item)
  }
  let keys: string[]
  try {
    keys = await Promise.all(questions.map(questionKey))
  } catch {
    return { ok: false, problems: ['Текст містить пошкоджені символи (одиночні сурогатні пари UTF-16)'] }
  }
  const firstByKey = new Map<string, number>()
  keys.forEach((key, i) => {
    const first = firstByKey.get(key)
    if (first === undefined) firstByKey.set(key, i)
    else problems.push(`${questionWhere(i, questions[i])}: повторює питання ${first + 1} (те саме питання, варіанти й правильна відповідь)`)
  })
  if (problems.length) return { ok: false, problems: limitProblems(problems) }
  questions.forEach((q, i) => {
    q.id = typeof raw[i].id === 'string' ? (raw[i].id as string) : `q-${keys[i]}`
  })
  contentWarnings(questions, resolvedMeta.lang, warn)

  const fileSlug = slugOf(fileName)
  const id = quizIdFor(pkg.source, fileSlug)
  const outMeta: QuizPackage['meta'] = { ...resolvedMeta }
  if (typeof metaObj.shuffle === 'boolean') outMeta.shuffle = metaObj.shuffle
  const out: QuizPackage = { format: 'quiz-package', format_version: 1, meta: outMeta, questions }
  if (Object.keys(strings as Obj).length) out.strings = strings as Record<string, string>
  if (isPackage) {
    if (data.course !== undefined) out.course = data.course as QuizPackage['course']
    if (data.producer !== undefined) out.producer = data.producer as QuizPackage['producer']
    if (pkg.source) out.source = pkg.source
    if (data.fragments !== undefined) out.fragments = pkg.fragments
  }
  const quiz = questions.length ? await buildQuiz(id, resolvedMeta, resolvedStrings, questions) : null
  return { ok: true, id, fileSlug, state: stateOf(questions), package: out, quiz, warnings }
}
