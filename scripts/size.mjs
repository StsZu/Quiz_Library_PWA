// Constitution IV, spec 002 SC-19 / FR-89: JavaScript of the production build, gzipped (quiz content excluded).
// The library loads at most 80 KB; the editor chunk, loaded only on «Створення квізу», at most 30 KB and is not
// part of the initial load.
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const INITIAL_LIMIT = 80 * 1024
const EDITOR_LIMIT = 30 * 1024
const dir = 'dist/assets'
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} КБ`
const html = readFileSync('dist/index.html', 'utf8')
const loaded = new Set([...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\.?\/?assets\/([^"]+\.js)"/g)].map((m) => m[1]))
const errors = []

let initial = 0
const editors = []
for (const name of readdirSync(dir).sort()) {
  if (!name.endsWith('.js')) continue
  const size = gzipSync(readFileSync(`${dir}/${name}`)).length
  const editor = name.startsWith('Editor-')
  if (editor) editors.push({ name, size })
  if (!editor || loaded.has(name)) initial += size
  console.log(`${name}: ${kb(size)} gzip${editor ? ' (редактор, окремий модуль)' : ''}`)
}
const sw = gzipSync(readFileSync('dist/sw.js')).length
console.log(`sw.js: ${kb(sw)} gzip (не входить у межу)`)

if (loaded.size === 0) errors.push('index.html не підключає жодного JS з dist/assets')
if (editors.length !== 1) errors.push(`очікувався один модуль редактора Editor-*.js, знайдено ${editors.length}`)
for (const { name, size } of editors) {
  if (loaded.has(name)) errors.push(`${name} підключено в index.html: редактор має вантажитися лише при відкритті (FR-89)`)
  console.log(`Редактор: ${kb(size)} gzip (межа ${EDITOR_LIMIT / 1024} КБ)`)
  if (size > EDITOR_LIMIT) errors.push(`модуль редактора ${kb(size)} > ${EDITOR_LIMIT / 1024} КБ`)
}
console.log(`Бібліотека (JS без модуля редактора): ${kb(initial)} gzip (межа ${INITIAL_LIMIT / 1024} КБ)`)
if (initial > INITIAL_LIMIT) errors.push(`JS бібліотеки ${kb(initial)} > ${INITIAL_LIMIT / 1024} КБ`)

for (const error of errors) console.error(`error: ${error}`)
process.exit(errors.length ? 1 : 0)
