// Constitution IV (security) and V.1: CSP without third-party domains in index.html and _headers,
// no external URLs in the built code, no secrets in tracked files or the build.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const problems = []
const html = readFileSync('dist/index.html', 'utf8')
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1]
if (!csp) problems.push('dist/index.html: немає CSP')
else if (/https?:/.test(csp)) problems.push(`dist/index.html: сторонній домен у CSP: ${csp}`)
if (existsSync('public/_headers')) {
  const headers = readFileSync('public/_headers', 'utf8')
  if (!/Content-Security-Policy: default-src 'self'/.test(headers)) problems.push('public/_headers: немає CSP default-src self')
  if (/Content-Security-Policy:[^\n]*https?:/.test(headers)) problems.push('public/_headers: сторонній домен у CSP')
}
for (const name of readdirSync('dist/assets')) {
  if (!name.endsWith('.js')) continue
  const code = readFileSync(`dist/assets/${name}`, 'utf8')
  const urls = [...code.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]).filter((u) => !/^https?:\/\/(www\.w3\.org|localhost)/.test(u))
  if (urls.length) problems.push(`dist/assets/${name}: зовнішні адреси ${[...new Set(urls)].join(', ')}`)
}
const secret = /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/
const tracked = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean)
for (const file of [...tracked, ...readdirSync('dist/assets').map((n) => `dist/assets/${n}`)]) {
  if (existsSync(file) && secret.test(readFileSync(file, 'utf8'))) problems.push(`${file}: схоже на секрет`)
}
if (problems.length) {
  for (const p of problems) console.error(`FAIL: ${p}`)
  process.exit(1)
}
console.log('OK: CSP без сторонніх доменів, зовнішніх адрес у коді й секретів немає')
