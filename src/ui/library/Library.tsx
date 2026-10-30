// Library: courses and quizzes with attempts, last result and mistakes (spec FR-10, FR-11).
import { useEffect, useState } from 'preact/hooks'
import type { Attempt, ContentIndex, InProgress, Quiz } from '../../contracts.ts'
import { allAttempts, allSessions, statsByQuiz } from '../../core/attempts.ts'
import { loadIndex, loadQuiz } from '../../core/content.ts'
import { mistakeKeys } from '../../core/mistakes.ts'
import { quizHref } from '../../app/router.ts'
import { Icon } from '../components/icons.tsx'
import { questionsLabel } from '../strings.ts'
import { Banners } from './Banners.tsx'

interface Data {
  index: ContentIndex
  quizzes: Map<string, Quiz>
  attempts: Attempt[]
  sessions: InProgress[]
}

async function loadAll(): Promise<Data> {
  const index = await loadIndex()
  const ids = index.courses.flatMap((c) => c.quizzes.map((q) => q.id))
  const quizzes = new Map((await Promise.all(ids.map(loadQuiz))).map((q) => [q.id, q]))
  return { index, quizzes, attempts: await allAttempts(), sessions: await allSessions() }
}

export function Library() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAll().then(setData).catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }, [])

  const stats = data ? statsByQuiz(data.attempts) : new Map()

  return (
    <>
      <header class="top-app-bar" id="app-bar">
        <div class="wrap">
          <div class="bar-row">
            <h1 class="bar-title title-large">Мої квізи</h1>
            <a class="icon-btn state" href="#/settings" aria-label="Налаштування"><Icon name="settings" /></a>
          </div>
        </div>
      </header>
      <main class="wrap screen">
        <Banners />
        {error && <p class="notice is-error" role="alert">{error}</p>}
        {!data && !error && <p class="muted" aria-busy="true">Завантаження…</p>}
        {data?.index.courses.map((course) => {
          const mistakes = course.quizzes.map((s) => {
            const quiz = data.quizzes.get(s.id)
            return quiz ? mistakeKeys(quiz, data.attempts, data.sessions).length : 0
          })
          const courseMistakes = mistakes.reduce((a, b) => a + b, 0)
          return (
            <section key={course.id} aria-labelledby={`course-${course.id}`}>
              <div class="course-head">
                <h2 class="title-large" id={`course-${course.id}`}>{course.title}</h2>
                {courseMistakes > 0 && <span class="badge-mistakes label-medium">{`Помилок: ${courseMistakes}`}</span>}
              </div>
              <ul class="quiz-list">
                {course.quizzes.map((summary, i) => {
                  const stat = stats.get(summary.id)
                  const inProgress = data.sessions.find((s) => s.quizId === summary.id && s.mode === 'full' && s.answers.length > 0)
                  const parts = [questionsLabel(summary.questions), `Спроб: ${stat?.attempts ?? 0}`]
                  if (stat?.last) parts.push(`Останній результат: ${stat.last.score} з ${stat.last.total}`)
                  if (inProgress) parts.push(`Розпочато: ${inProgress.answers.length} з ${inProgress.keys.length}`)
                  return (
                    <li class="quiz-card" key={summary.id} data-quiz={summary.id}>
                      <a class="quiz-open state" href={quizHref(summary.id)}>
                        <span class="title-medium">{summary.title}</span>
                        <span class="quiz-meta body-medium">{parts.join(' · ')}</span>
                      </a>
                      {mistakes[i] > 0 && (
                        <div class="quiz-actions">
                          <a class="btn btn-tonal state" href={quizHref(summary.id, 'mistakes')}>{`Повторити помилки (${mistakes[i]})`}</a>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </main>
    </>
  )
}
