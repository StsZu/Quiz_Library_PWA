// Quiz screen: the behaviour of Creator_quiz/templates/quiz-md3.html (spec FR-20…FR-23, FR-30…FR-34).
// Element ids and the embedded #quiz-data / #quiz-strings follow the template, so tools/audit_page.js works unchanged (FR-21).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Attempt, InProgress, Mode, Question, Quiz } from '../../contracts.ts'
import { allAttempts, allSessions, finishSession, getSession, newSession, saveSession, toAttempt, withAnswer } from '../../core/attempts.ts'
import { loadQuiz } from '../../core/content.ts'
import { mistakeKeys } from '../../core/mistakes.ts'
import { go, quizHref } from '../../app/router.ts'
import { Icon } from '../components/icons.tsx'
import { commentKey, fill } from '../strings.ts'

interface Props {
  quizId: string
  mode: Mode
}

type Loaded = { quiz: Quiz; session: InProgress; index: number }

const RESTART_CONFIRM = 'Почати спочатку? Відповіді цієї спроби буде скинуто.'

/** Keys of the session: all questions, or the current mistakes (without the mistakes session being replaced). */
async function sessionKeys(quiz: Quiz, mode: Mode): Promise<string[]> {
  if (mode === 'full') return quiz.questions.map((q) => q.key)
  const sessions = (await allSessions()).filter((s) => !(s.quizId === quiz.id && s.mode === 'mistakes'))
  return mistakeKeys(quiz, await allAttempts(), sessions)
}

async function load(quizId: string, mode: Mode): Promise<Loaded | 'no-mistakes'> {
  const quiz = await loadQuiz(quizId)
  const valid = new Set(quiz.questions.map((q) => q.key))
  const saved = await getSession(quizId, mode)
  if (saved && saved.contentHash === quiz.contentHash && saved.keys.length && saved.keys.every((k) => valid.has(k)) && saved.answers.length < saved.keys.length) {
    const index = saved.keys.findIndex((k) => !saved.answers.some((a) => a.key === k))
    return { quiz, session: saved, index }
  }
  const keys = await sessionKeys(quiz, mode)
  if (!keys.length) return 'no-mistakes'
  const session = newSession(quiz, mode, keys)
  await saveSession(session)
  return { quiz, session, index: 0 }
}

export function QuizScreen({ quizId, mode }: Props) {
  const [state, setState] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Attempt | null>(null)
  const [mistakesLeft, setMistakesLeft] = useState(0)
  const [reviewOpen, setReviewOpen] = useState(false)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const keyboardAnswer = useRef(false)
  const reveal = useRef(false)
  const focusHeading = useRef(false)
  const focusResult = useRef(false)
  const refs = {
    appBar: useRef<HTMLElement>(null),
    quiz: useRef<HTMLElement>(null),
    card: useRef<HTMLElement>(null),
    heading: useRef<HTMLHeadingElement>(null),
    options: useRef<HTMLOListElement>(null),
    dock: useRef<HTMLDivElement>(null),
    next: useRef<HTMLButtonElement>(null),
    resultTitle: useRef<HTMLHeadingElement>(null),
  }

  const persist = (work: () => Promise<unknown>) => {
    saving.current = saving.current.then(work).catch((e) => setError(`Не вдалося зберегти відповідь: ${String(e)}`))
    return saving.current
  }

  useEffect(() => {
    let alive = true
    setState(null)
    setResult(null)
    setError(null)
    load(quizId, mode)
      .then((loaded) => {
        if (!alive) return
        if (loaded === 'no-mistakes') setError('Помилок у цьому квізі немає.')
        else setState(loaded)
      })
      .catch((e) => alive && setError(String(e instanceof Error ? e.message : e)))
    return () => { alive = false }
  }, [quizId, mode])

  const quiz = state?.quiz
  const session = state?.session
  const questions: Question[] = quiz && session ? session.keys.map((k) => quiz.questions.find((q) => q.key === k)!) : []
  const total = questions.length
  const current = state ? questions[state.index] : undefined
  const answer = current && session ? session.answers.find((a) => a.key === current.key) : undefined
  const score = session ? session.answers.filter((a) => a.correct).length : 0
  const strings = quiz?.strings ?? {}
  const t = (key: string, vars?: Record<string, string | number>) => fill(strings, key, vars)

  const syncDock = () => {
    const dock = refs.dock.current
    const card = refs.card.current
    const bar = refs.appBar.current
    if (bar) document.documentElement.style.setProperty('--app-bar-height', `${bar.offsetHeight}px`)
    if (!dock || !card) return
    document.documentElement.style.setProperty('--dock-height', `${dock.offsetHeight}px`)
    dock.classList.toggle('is-stuck', dock.getBoundingClientRect().top < card.getBoundingClientRect().bottom)
  }

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        refs.appBar.current?.classList.toggle('is-scrolled', window.scrollY > 0)
        syncDock()
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', syncDock)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', syncDock)
      document.documentElement.style.removeProperty('--dock-height')
    }
  }, [])

  useLayoutEffect(() => {
    syncDock()
    if (focusHeading.current) {
      focusHeading.current = false
      const top = refs.quiz.current?.getBoundingClientRect().top ?? 0
      const barHeight = refs.appBar.current?.offsetHeight ?? 0
      if (top < barHeight) window.scrollBy(0, top - barHeight - 16)
      refs.heading.current?.focus({ preventScroll: true })
    }
    if (reveal.current && current) {
      reveal.current = false
      // Scroll just enough to show the marked options above the dock, but never past the question heading.
      const buttons = Array.from(refs.options.current?.querySelectorAll<HTMLButtonElement>('.option') ?? [])
      const marked = buttons.filter((b) => b.classList.contains('is-correct') || b.classList.contains('is-wrong'))
      const bottom = Math.max(...marked.map((b) => b.getBoundingClientRect().bottom))
      const needed = Math.max(0, bottom + 8 - (refs.dock.current?.getBoundingClientRect().top ?? window.innerHeight))
      const limit = Math.max(0, (refs.heading.current?.getBoundingClientRect().top ?? 0) - (refs.appBar.current?.offsetHeight ?? 0) - 8)
      const delta = Math.min(needed, limit)
      if (delta) window.scrollBy(0, delta)
      if (keyboardAnswer.current) refs.next.current?.focus({ preventScroll: true })
    }
    if (focusResult.current && result) {
      focusResult.current = false
      refs.resultTitle.current?.focus({ preventScroll: true })
    }
  })

  const choose = (choice: number, byKeyboard: boolean) => {
    if (!state || !current || answer) return
    const next = withAnswer(state.session, current.key, choice, choice === current.correct)
    keyboardAnswer.current = byKeyboard
    reveal.current = true
    setState({ ...state, session: next })
    persist(() => saveSession(next))
  }

  const finish = () => {
    if (!state || !quiz) return
    const attempt = toAttempt(state.session)
    focusResult.current = true
    setResult(attempt)
    setReviewOpen(false)
    window.scrollTo(0, 0)
    persist(async () => {
      await finishSession(state.session, attempt.finishedAt)
      setMistakesLeft(mistakeKeys(quiz, await allAttempts(), await allSessions()).length)
    })
  }

  const goNext = () => {
    if (!state || !answer) return
    if (state.index < total - 1) {
      focusHeading.current = true
      setState({ ...state, index: state.index + 1 })
    } else {
      finish()
    }
  }

  const restart = async (confirmFirst: boolean) => {
    if (!state || !quiz) return
    if (confirmFirst && state.session.answers.length && !window.confirm(RESTART_CONFIRM)) return
    await saving.current
    const keys = mode === 'full' ? quiz.questions.map((q) => q.key) : result ? mistakeKeys(quiz, await allAttempts(), []) : state.session.keys
    if (!keys.length) {
      go('#/')
      return
    }
    const session = newSession(quiz, mode, keys)
    setResult(null)
    setReviewOpen(false)
    setState({ quiz, session, index: 0 })
    window.scrollTo(0, 0)
    focusHeading.current = true
    persist(() => saveSession(session))
  }

  // The listener is registered once and reads the latest render, so a fast key press after Enter is not lost.
  const latest = useRef({ current, answer, result, choose })
  latest.current = { current, answer, result, choose }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { current, answer, result, choose } = latest.current
      if (event.ctrlKey || event.metaKey || event.altKey || result || !current) return
      const buttons = Array.from(refs.options.current?.querySelectorAll<HTMLButtonElement>('.option') ?? [])
      if (/^[1-9]$/.test(event.key)) {
        const n = Number(event.key) - 1
        if (n < buttons.length && !answer) {
          event.preventDefault()
          choose(n, true)
        }
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const enabled = buttons.filter((b) => !b.disabled)
        const at = enabled.indexOf(document.activeElement as HTMLButtonElement)
        if (!enabled.length || (at === -1 && !refs.card.current?.contains(document.activeElement))) return
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        const target = at === -1 ? (step > 0 ? 0 : enabled.length - 1) : (at + step + enabled.length) % enabled.length
        enabled[target].focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (error) {
    return (
      <main class="wrap screen">
        <p class="notice is-error body-large" role="alert">{error}</p>
        <div class="actions"><a class="btn btn-tonal state" href="#/">До бібліотеки</a></div>
      </main>
    )
  }
  if (!state || !quiz || !current) return <main class="wrap screen" aria-busy="true"><p class="muted">Завантаження…</p></main>

  const answered = session!.answers.length
  const percent = result ? Math.round((result.score / result.total) * 100) : 0
  const optionAria = String(strings.optionAria ?? '').split('{text}')

  return (
    <>
      <header class="top-app-bar" id="app-bar" ref={refs.appBar}>
        <div class="wrap">
          <div class="bar-row">
            <a class="icon-btn bar-back state" href="#/" aria-label="До бібліотеки"><Icon name="back" /></a>
            <h1 class="bar-title title-large"><span class="bar-title-one">{quiz.meta.title}</span></h1>
          </div>
          <div class="bar-chips label-medium">
            <span class="chip chip-strong" id="chip-counter">{t('questionCounter', { current: Math.min(state.index + 1, total), total })}</span>
            <span class="chip" id="chip-score">{t('scoreLabel', { score })}</span>
            {mode === 'mistakes' && <span class="chip chip-tonal">Повторення помилок</span>}
          </div>
        </div>
        <div class="wrap">
          <div class="progress" id="progress" role="progressbar" aria-label={t('progressLabel')} aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
            <div class="progress-indicator" style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
          </div>
        </div>
      </header>

      <main class="wrap" lang={quiz.meta.lang} dir={quiz.meta.dir}>
        {state.index === 0 && !result && quiz.meta.description && <p class="subtitle body-medium">{quiz.meta.description}</p>}

        <section id="quiz" ref={refs.quiz} aria-label={t('quizRegion')} hidden={!!result}>
          <article class="card card-elevated enter" id="q-card" ref={refs.card} key={current.key}>
            <h2 class="q-heading" id="q-heading" tabIndex={-1} ref={refs.heading}>
              <span class="q-title title-medium" id="q-title">{current.title}</span>
              <span class="q-text body-large" id="q-text">{current.question}</span>
            </h2>
            <ol class="options" id="options" ref={refs.options}>
              {current.options.map((text, i) => {
                const isCorrect = !!answer && i === current.correct
                const isWrong = !!answer && i === answer.choice && !answer.correct
                const n = String(i + 1)
                return (
                  <li key={i}>
                    <button
                      type="button"
                      class={`option state body-large${isCorrect ? ' is-correct' : ''}${isWrong ? ' is-wrong' : ''}`}
                      disabled={!!answer}
                      onClick={(e) => choose(i, e.detail === 0)}
                    >
                      <span class="option-num label-large" aria-hidden="true">{n}</span>
                      <span class="sr-only">{(optionAria[0] ?? '').split('{n}').join(n)}</span>
                      <span class="option-text">{text}</span>
                      <span class="sr-only">{optionAria.slice(1).join(text).split('{n}').join(n)}</span>
                      <span class="option-mark sr-only">{isCorrect ? ` (${t('correctMark')})` : isWrong ? ` (${t('incorrectMark')})` : ''}</span>
                      {(isCorrect || isWrong) && <Icon name={isCorrect ? 'check' : 'close'} class="option-icon" />}
                    </button>
                  </li>
                )
              })}
            </ol>
            <p class="kbd-hint label-small" id="kbd-hint">{t('keyboardHint', { max: current.options.length })}</p>
          </article>
          <div class="dock" id="dock" ref={refs.dock}>
            <div class="feedback-region" id="feedback" role="status" aria-live="polite" aria-atomic="true" aria-label={t('feedbackRegion')}>
              {answer && (
                <div class={`feedback ${answer.correct ? 'is-correct' : 'is-wrong'}`}>
                  <Icon name={answer.correct ? 'check' : 'close'} />
                  <div class="feedback-body body-medium">
                    <strong class="title-medium">{t(answer.correct ? 'correct' : 'incorrect')}</strong>
                    {!answer.correct && (
                      <p>
                        <span aria-hidden="true">{t('correctAnswerIs', { answer: current.correct + 1 })}</span>
                        <span class="sr-only">{t('correctAnswerIs', { answer: current.options[current.correct] })}</span>
                      </p>
                    )}
                    <p>{current.feedback}</p>
                  </div>
                </div>
              )}
            </div>
            <div class="actions">
              <button type="button" class="btn btn-outlined state" id="btn-restart-during" onClick={() => restart(true)}><span>{t('restartDuring')}</span></button>
              <span class="spacer" />
              <button type="button" class="btn btn-filled state" id="btn-next" ref={refs.next} disabled={!answer} onClick={goNext}>
                <span>{t(state.index === total - 1 ? 'showResult' : 'next')}</span>
              </button>
            </div>
          </div>
        </section>

        <section id="result" aria-label={t('resultRegion')} hidden={!result}>
          {result && (
            <article class="card card-elevated result enter">
              <h2 class="result-title headline-small" id="result-title" tabIndex={-1} ref={refs.resultTitle}>{t('resultTitle')}</h2>
              <p class="result-percent display-small" id="result-percent">{`${percent}%`}</p>
              <p class="body-large" id="result-summary">{t('resultSummary', { score: result.score, total: result.total })}</p>
              <p class="result-comment body-medium" id="result-comment">{t(commentKey(percent))}</p>
              <div class="actions">
                {mistakesLeft > 0 && (
                  <a class="btn btn-filled state" href={quizHref(quiz.id, 'mistakes')} lang="uk" onClick={(e) => { if (mode === 'mistakes') { e.preventDefault(); restart(false) } }}>
                    {`Повторити помилки (${mistakesLeft})`}
                  </a>
                )}
                <button type="button" class="btn btn-tonal state" id="btn-restart" onClick={() => restart(false)}><span>{t('restart')}</span></button>
                <a class="btn btn-outlined state" href="#/" lang="uk">До бібліотеки</a>
              </div>
              <details class="review" id="review" open={reviewOpen} onToggle={(e) => setReviewOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary class="btn btn-text state"><span>{t('reviewToggle')}</span><Icon name="expand" class="chevron icon" /></summary>
                <ol class="review-list" id="review-list">
                  {reviewOpen && questions.map((q) => {
                    const given = result.answers.find((a) => a.key === q.key)
                    return (
                      <li class="review-item" key={q.key}>
                        <div class="review-head"><div><h3 class="title-medium">{q.title}</h3><p class="body-medium muted">{q.question}</p></div></div>
                        {given && <ReviewAnswer label={t('reviewYourAnswer')} text={q.options[given.choice]} correct={given.correct} mark={t(given.correct ? 'correctMark' : 'incorrectMark')} />}
                        {!given?.correct && <ReviewAnswer label={t('reviewCorrectAnswer')} text={q.options[q.correct]} correct mark={t('correctMark')} />}
                        <p class="body-medium">{q.feedback}</p>
                      </li>
                    )
                  })}
                </ol>
              </details>
            </article>
          )}
        </section>
      </main>
      <script type="application/json" id="quiz-data">{JSON.stringify(questions.map(({ key: _key, ...q }) => q))}</script>
      <script type="application/json" id="quiz-strings">{JSON.stringify(strings)}</script>
    </>
  )
}

function ReviewAnswer({ label, text, correct, mark }: { label: string; text: string; correct: boolean; mark: string }) {
  return (
    <div class={`review-answer ${correct ? 'is-correct' : 'is-wrong'}`}>
      <Icon name={correct ? 'check' : 'close'} />
      <div class="body-medium">
        <span class="review-answer-label label-medium">{label}</span>
        {text}
        <span class="sr-only">{` (${mark})`}</span>
      </div>
    </div>
  )
}
