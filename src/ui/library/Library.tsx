// Library: courses and quizzes with attempts, last result and mistakes (spec FR-10, FR-11); after the built-in
// courses, the courses of quizzes from disk (spec 002, FR-70) and the «Відкрити файл» button (FR-60).
import { useEffect, useState } from 'preact/hooks'
import type { Attempt, ContentIndex, InProgress, Quiz, UserQuiz } from '../../contracts.ts'
import { allAttempts, allSessions, statsByQuiz, type QuizStats } from '../../core/attempts.ts'
import { loadIndex, loadQuiz } from '../../core/content.ts'
import { mistakeKeys } from '../../core/mistakes.ts'
import { listUserQuizzes, userCourses } from '../../core/userQuizzes.ts'
import { quizHref } from '../../app/router.ts'
import { Icon } from '../components/icons.tsx'
import { questionsLabel } from '../strings.ts'
import { Banners } from './Banners.tsx'
import { OpenFileButton, OpenFilePanel } from './OpenFile.tsx'

interface Data {
  index: ContentIndex
  quizzes: Map<string, Quiz>
  userQuizzes: UserQuiz[]
  attempts: Attempt[]
  sessions: InProgress[]
}

async function loadAll(): Promise<Data> {
  const index = await loadIndex()
  const ids = index.courses.flatMap((c) => c.quizzes.map((q) => q.id))
  const quizzes = new Map((await Promise.all(ids.map(loadQuiz))).map((q) => [q.id, q]))
  return { index, quizzes, userQuizzes: await listUserQuizzes(), attempts: await allAttempts(), sessions: await allSessions() }
}

interface CardProps {
  id: string
  title: string
  quiz: Quiz | undefined
  questions: number
  stat: QuizStats | undefined
  data: Data
  note?: string
}

function QuizCard({ id, title, quiz, questions, stat, data, note }: CardProps) {
  const mistakes = quiz ? mistakeKeys(quiz, data.attempts, data.sessions).length : 0
  const inProgress = data.sessions.find((s) => s.quizId === id && s.mode === 'full' && s.answers.length > 0)
  const parts = note ? [note] : [questionsLabel(questions), `Спроб: ${stat?.attempts ?? 0}`]
  if (!note && stat?.last) parts.push(`Останній результат: ${stat.last.score} з ${stat.last.total}`)
  if (!note && inProgress) parts.push(`Розпочато: ${inProgress.answers.length} з ${inProgress.keys.length}`)
  return (
    <li class="quiz-card" data-quiz={id}>
      {quiz ? (
        <a class="quiz-open state" href={quizHref(id)}>
          <span class="title-medium">{title}</span>
          <span class="quiz-meta body-medium">{parts.join(' · ')}</span>
        </a>
      ) : (
        <div class="quiz-open">
          <span class="title-medium">{title}</span>
          <span class="quiz-meta body-medium">{parts.join(' · ')}</span>
        </div>
      )}
      {mistakes > 0 && (
        <div class="quiz-actions">
          <a class="btn btn-tonal state" href={quizHref(id, 'mistakes')}>{`Повторити помилки (${mistakes})`}</a>
        </div>
      )}
    </li>
  )
}

function CourseHead({ id, title, mistakes }: { id: string; title: string; mistakes: number }) {
  return (
    <div class="course-head">
      <h2 class="title-large" id={id}>{title}</h2>
      {mistakes > 0 && <span class="badge-mistakes label-medium">{`Помилок: ${mistakes}`}</span>}
    </div>
  )
}

const countMistakes = (quizzes: (Quiz | null | undefined)[], data: Data) =>
  quizzes.reduce((sum, quiz) => sum + (quiz ? mistakeKeys(quiz, data.attempts, data.sessions).length : 0), 0)

export function Library() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = () => loadAll().then(setData).catch((e) => setError(String(e instanceof Error ? e.message : e)))
  useEffect(() => { void reload() }, [])

  const stats = data ? statsByQuiz(data.attempts) : new Map<string, QuizStats>()
  const builtIn = new Map(data?.index.courses.flatMap((c) => c.quizzes.map((q) => [q.id, c.title] as const)) ?? [])

  return (
    <>
      <header class="top-app-bar" id="app-bar">
        <div class="wrap">
          <div class="bar-row">
            <h1 class="bar-title title-large">Мої квізи</h1>
            <OpenFileButton />
            <a class="icon-btn state" href="#/settings" aria-label="Налаштування"><Icon name="settings" /></a>
          </div>
        </div>
      </header>
      <main class="wrap screen">
        <Banners />
        <OpenFilePanel builtIn={builtIn} onSaved={() => { void reload() }} />
        {error && <p class="notice is-error" role="alert">{error}</p>}
        {!data && !error && <p class="muted" aria-busy="true">Завантаження…</p>}
        {data?.index.courses.map((course) => (
          <section key={course.id} aria-labelledby={`course-${course.id}`}>
            <CourseHead id={`course-${course.id}`} title={course.title} mistakes={countMistakes(course.quizzes.map((s) => data.quizzes.get(s.id)), data)} />
            <ul class="quiz-list">
              {course.quizzes.map((summary) => (
                <QuizCard key={summary.id} id={summary.id} title={summary.title} quiz={data.quizzes.get(summary.id)} questions={summary.questions} stat={stats.get(summary.id)} data={data} />
              ))}
            </ul>
          </section>
        ))}
        {data && userCourses(data.userQuizzes).map((course) => (
          <section key={`local-${course.id}`} aria-labelledby={`local-course-${course.id}`} data-local-course={course.id}>
            <CourseHead id={`local-course-${course.id}`} title={course.title} mistakes={countMistakes(course.quizzes.map((q) => q.quiz), data)} />
            <ul class="quiz-list">
              {course.quizzes.map((q) => (
                <QuizCard
                  key={q.id} id={q.id} title={q.package.meta.title} quiz={q.quiz ?? undefined} questions={q.package.questions.length}
                  stat={stats.get(q.id)} data={data} note={q.state === 'material' ? 'Матеріал без питань' : undefined}
                />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  )
}
