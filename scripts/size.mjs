// Constitution IV: JavaScript of the production build, gzipped, must stay within 80 KB (quiz content excluded).
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const LIMIT = 80 * 1024
const dir = 'dist/assets'
let total = 0
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.js')) continue
  const size = gzipSync(readFileSync(`${dir}/${name}`)).length
  total += size
  console.log(`${name}: ${(size / 1024).toFixed(1)} КБ gzip`)
}
const sw = gzipSync(readFileSync('dist/sw.js')).length
console.log(`sw.js: ${(sw / 1024).toFixed(1)} КБ gzip (не входить у межу)`)
console.log(`Разом JS: ${(total / 1024).toFixed(1)} КБ gzip (межа ${LIMIT / 1024} КБ)`)
process.exit(total <= LIMIT ? 0 : 1)
