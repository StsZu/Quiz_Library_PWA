import type { QuizStrings } from '../contracts.ts'

/** Fills «{name}» variables of a quiz string, as the template does. */
export function fill(strings: QuizStrings, key: string, vars: Record<string, string | number> = {}): string {
  let text = String(strings[key] ?? '')
  for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
  return text
}

export function commentKey(percent: number): string {
  if (percent >= 90) return 'comment90'
  if (percent >= 70) return 'comment70'
  if (percent >= 50) return 'comment50'
  return 'commentLow'
}

/** «1 питання», «2 питання», «5 питань». */
export function questionsLabel(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} питання`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} питання`
  return `${n} питань`
}
