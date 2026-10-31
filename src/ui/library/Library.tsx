// Library: courses and quizzes with attempts, last result and mistakes (spec FR-10, FR-11); after the built-in
// courses, the courses of quizzes from disk with their state and actions (spec 002, FR-60, FR-70…FR-72).
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Attempt, ContentIndex, InProgress, Quiz, UserQuiz } from '../../contracts.ts'
import { allAttempts, allSessions, statsByQuiz, type QuizStats } from '../../core/attempts.ts'
import { loadIndex, loadQuiz } from '../../core/content.ts'
import { mistakeKeys } from '../../core/mistakes.ts'
import { deleteUserQuiz, listUserQuizzes, userCourses } from '../../core/userQuizzes.ts'
import { saveUserQuizFile } from '../../app/files.ts'
import { editHref, quizHref } from '../../app/router.ts'
import { Icon } from '../components/icons.tsx'
import { questionsLabel } from '../strings.ts'
import { Banners } from './Banners.tsx'
import { OpenFileButton, OpenFilePanel } from './OpenFile.tsx'

interface Data {
  index: ContentIndex
  quizzes: Map<string, Quiz>
  /** FR-72: a built-in quiz that failed to load, with the reason; the rest of the library still works. */
  failed: Map<string, string>
  userQuizzes: UserQuiz[]
  attempts: Attempt[]
  sessions: InProgress[]
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function loadAll(): Promise<Data> {
  const index = await loadIndex()
  const ids = index.courses.flatMap((c) => c.quizzes.map((q) => q.id))
  const results = await Promise.allSettled(ids.map(loadQuiz))
  const quizzes = new Map<string, Quiz>()
  const failed = new Map<string, string>()
  results.forEach((r, i) => (r.status === 'fulfilled' ? quizzes.set(ids[i], r.value) : failed.set(ids[i], reason(r.reason))))
  return { index, quizzes, failed, userQuizzes: await listUserQuizzes(), attempts: await allAttempts(), sessions: await allSessions() }
}

interface CardProps {
  id: string
  title: string
  quiz: Quiz | undefined
  questions: number
  stat: QuizStats | undefined
  data: Data
  local?: UserQuiz
  error?: string
  onDelete?: (quiz: UserQuiz) => void
}

function stateNote(local: UserQuiz | undefined): string | null {
  if (!local || local.state === 'ready') return null
  if (local.state === 'material') return 'Матеріал без питань'
  const reviewed = local.package.questions.filter((q) => q.reviewed).length
  return `Чернетка · переглянуто ${reviewed} з ${local.package.questions.length}`
}

function QuizCard({ id, title, quiz, questions, stat, data, local, error, onDelete }: CardProps) {
  const note = error ? `Не вдалося відкрити: ${error}` : stateNote(local)
  const playable = quiz && !note
  const mistakes = playable ? mistakeKeys(quiz, data.attempts, data.sessions).length : 0
  const inProgress = data.sessions.find((s) => s.quizId === id && s.mode === 'full' && s.answers.length > 0)
  const parts = note ? [note] : [questionsLabel(questions), `Спроб: ${stat?.attempts ?? 0}`]
  if (!note && stat?.last) parts.push(`Останній результат: ${stat.last.score} з ${stat.last.total}`)
  if (!note && inProgress) parts.push(`Розпочато: ${inProgress.answers.length} з ${inProgress.keys.length}`)
  if (local?.workingCopy) parts.push('є незавершені зміни в редакторі')
  const head = (
    <>
      <span class="title-medium">{title}</span>
      {local && <span class="chip-file label-medium">З файлу</span>}
      <span class="quiz-meta body-medium">{parts.join(' · ')}</span>
    </>
  )
  return (
    <li class={`quiz-card${error ? ' is-error' : ''}`} data-quiz={id}>
      {playable ? <a class="quiz-open state" href={quizHref(id)}>{head}</a> : <div class="quiz-open">{head}</div>}
      {(mistakes > 0 || local) && (
        <div class="quiz-actions">
          {mistakes > 0 && <a class="btn btn-tonal state" href={quizHref(id, 'mistakes')}>{`Повторити помилки (${mistakes})`}</a>}
          {local && (
            <>
              <a class="btn btn-text state" data-action="edit" href={editHref(local.id)}>{local.state === 'material' ? 'Створити питання' : 'Редагувати'}</a>
              <button type="button" class="btn btn-text state" data-action="save" onClick={() => { void saveUserQuizFile(local) }}>Зберегти файл</button>
              <button type="button" class="btn btn-text state" data-action="delete" onClick={() => onDelete?.(local)}>Видалити</button>
            </>
          )}
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
  const [deleting, setDeleting] = useState<UserQuiz | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  const reload = () => loadAll().then(setData).catch((e) => setError(reason(e)))
  useEffect(() => { void reload() }, [])
  useEffect(() => {
    if (deleting && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [deleting])

  const closeDelete = () => {
    dialog.current?.close()
    setDeleting(null)
  }
  const confirmDelete = async () => {
    if (!deleting) return
    await deleteUserQuiz(deleting.id)
    closeDelete()
    void reload()
  }

  const stats = data ? statsByQuiz(data.attempts) : new Map<string, QuizStats>()
  const builtIn = new Map(data?.index.courses.flatMap((c) => c.quizzes.map((q) => [q.id, c.title] as const)) ?? [])
  const playableLocal = (q: UserQuiz) => (q.state === 'ready' ? q.quiz : null)

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
                <QuizCard
                  key={summary.id} id={summary.id} title={summary.title} quiz={data.quizzes.get(summary.id)} questions={summary.questions}
                  stat={stats.get(summary.id)} data={data} error={data.failed.get(summary.id)}
                />
              ))}
            </ul>
          </section>
        ))}
        {data && userCourses(data.userQuizzes).map((course) => (
          <section key={`local-${course.id}`} aria-labelledby={`local-course-${course.id}`} data-local-course={course.id}>
            <CourseHead id={`local-course-${course.id}`} title={course.title} mistakes={countMistakes(course.quizzes.map(playableLocal), data)} />
            <ul class="quiz-list">
              {course.quizzes.map((q) => (
                <QuizCard
                  key={q.id} id={q.id} title={q.package.meta.title} quiz={q.quiz ?? undefined} questions={q.package.questions.length}
                  stat={stats.get(q.id)} data={data} local={q} onDelete={setDeleting}
                />
              ))}
            </ul>
          </section>
        ))}
      </main>

      <dialog class="modal" ref={dialog} onClose={() => setDeleting(null)} aria-labelledby="delete-dialog-title">
        <h2 class="headline-small" id="delete-dialog-title">{`Видалити «${deleting?.package.meta.title ?? ''}»?`}</h2>
        <p class="body-medium">Квіз зникне з цього пристрою. Завершені спроби лишаються в історії та в експорті прогресу: якщо відкрити файл знову, статистика повернеться.</p>
        <div class="actions">
          <button type="button" class="btn btn-text state" onClick={closeDelete}>Скасувати</button>
          <button type="button" class="btn btn-filled state" id="btn-confirm-delete" onClick={confirmDelete}>Видалити</button>
        </div>
      </dialog>
    </>
  )
}
