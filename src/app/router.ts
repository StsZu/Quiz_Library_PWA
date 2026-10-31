// Hash routes (spec A5): #/ library, #/quiz/<id>, #/quiz/<id>/mistakes, #/settings; spec 002: #/edit/<id>.
import { signal } from '@preact/signals'
import type { Mode } from '../contracts.ts'

export type Route =
  | { name: 'library' }
  | { name: 'quiz'; quizId: string; mode: Mode }
  | { name: 'settings' }
  | { name: 'edit'; quizId: string }

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'quiz' && parts[1]) return { name: 'quiz', quizId: parts[1], mode: parts[2] === 'mistakes' ? 'mistakes' : 'full' }
  if (parts[0] === 'settings') return { name: 'settings' }
  if (parts[0] === 'edit' && parts[1]) return { name: 'edit', quizId: parts[1] }
  return { name: 'library' }
}

export const quizHref = (quizId: string, mode: Mode = 'full') => `#/quiz/${encodeURIComponent(quizId)}${mode === 'mistakes' ? '/mistakes' : ''}`

export const editHref = (quizId: string) => `#/edit/${encodeURIComponent(quizId)}`

export const route = signal<Route>(parseRoute(location.hash))

window.addEventListener('hashchange', () => {
  route.value = parseRoute(location.hash)
})

export function go(hash: string) {
  if (location.hash === hash) route.value = parseRoute(hash)
  else location.hash = hash
}
