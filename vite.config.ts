import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { formatBuildVersion } from './src/core/version.ts'

/** Short commit hash: the Cloudflare build variable, otherwise git; null when neither is available. */
function commit(): string | null {
  const sha = process.env.WORKERS_CI_COMMIT_SHA
  if (sha) return sha.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}

const appVersion = formatBuildVersion(new Date(), commit())

/** Every file under public/, as paths relative to the site root (headers are not served as files). */
function publicFiles(dir = 'public'): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return publicFiles(path)
    return name === '_headers' || name === '.DS_Store' ? [] : [relative('public', path)]
  })
}

/** Emits sw.js with the built files and all quiz content to precache (no Workbox dependency). */
function serviceWorker(): Plugin {
  return {
    name: 'quiz-library-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((name) => !name.endsWith('.map'))
      const precache = ['./', ...files, ...publicFiles()]
      const source = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8')
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__VERSION__', appVersion)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [preact(), serviceWorker()],
  define: {
    __TEST_MODE__: JSON.stringify(mode !== 'production'),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: mode === 'test' ? 'dist-test' : 'dist',
    target: 'safari16',
    sourcemap: false,
  },
}))
