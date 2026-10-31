// Constitution IV (security) and V.1: CSP without third-party domains in index.html and _headers,
// no external URLs in the built code, no secrets in tracked files or the build.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

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
// Spec 002, FR-95 / SC-21: app icons are opaque, have the declared sizes and the maskable one keeps the safe zone;
// favicons are linked and shipped.
function png(path) {
  const data = readFileSync(path)
  const ihdr = { width: data.readUInt32BE(16), height: data.readUInt32BE(20), depth: data[24], type: data[25], interlace: data[28] }
  const idat = []
  for (let pos = 8; pos < data.length;) {
    const length = data.readUInt32BE(pos)
    if (data.toString('latin1', pos + 4, pos + 8) === 'IDAT') idat.push(data.subarray(pos + 8, pos + 8 + length))
    pos += 12 + length
  }
  return { ...ihdr, idat: Buffer.concat(idat) }
}

/** RGB rows of an 8-bit, non-interlaced colour-type-2 PNG. */
function rgbRows({ width, height, idat }) {
  const raw = inflateSync(idat)
  const stride = width * 3
  const rows = []
  let prev = new Uint8Array(stride)
  for (let y = 0, i = 0; y < height; y++, i += stride + 1) {
    const filter = raw[i]
    const line = Uint8Array.from(raw.subarray(i + 1, i + 1 + stride))
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? line[x - 3] : 0
      const b = prev[x]
      const c = x >= 3 ? prev[x - 3] : 0
      const p = a + b - c
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, paeth][filter]) & 255
    }
    rows.push(line)
    prev = line
  }
  return rows
}

const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'))
const touch = html.match(/<link rel="apple-touch-icon" href="\.\/([^"]+)"/)?.[1]
const icons = [...manifest.icons, ...(touch ? [{ src: touch, sizes: '180x180', purpose: 'apple-touch-icon' }] : [])]
if (!touch) problems.push('dist/index.html: немає apple-touch-icon')
for (const icon of icons) {
  const file = `dist/${icon.src}`
  if (!existsSync(file)) {
    problems.push(`${icon.src}: файлу немає`)
    continue
  }
  const image = png(file)
  if (`${image.width}x${image.height}` !== icon.sizes) problems.push(`${icon.src}: ${image.width}x${image.height}, а в manifest ${icon.sizes}`)
  if (image.type !== 2 || image.depth !== 8 || image.interlace !== 0) problems.push(`${icon.src}: має бути RGB без альфа-каналу (тип 2, 8 біт), а не тип ${image.type}`)
  else if (icon.purpose === 'maskable') {
    const rows = rgbRows(image)
    const bg = rows[0].subarray(0, 3)
    let outside = 0
    rows.forEach((row, y) => {
      for (let x = 0; x < image.width; x++) {
        const far = Math.hypot(x + 0.5 - image.width / 2, y + 0.5 - image.height / 2) > 0.4 * image.width
        if (far && Math.max(...[0, 1, 2].map((i) => Math.abs(row[x * 3 + i] - bg[i]))) > 40) outside++
      }
    })
    if (outside) problems.push(`${icon.src}: ${outside} пікселів малюнка поза безпечною зоною maskable (коло 40 %)`)
  }
}
for (const favicon of ['favicon.ico', 'favicon.svg', 'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/favicon-48.png']) {
  if (!existsSync(`dist/${favicon}`)) problems.push(`${favicon}: файлу немає в збірці`)
  if (!html.includes(`href="./${favicon}"`)) problems.push(`dist/index.html: немає посилання на ${favicon}`)
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL: ${p}`)
  process.exit(1)
}
console.log('OK: CSP без сторонніх доменів, зовнішніх адрес у коді й секретів немає; іконки непрозорі, розміри як у manifest, maskable у безпечній зоні, favicon на місці')
