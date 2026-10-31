// «Створення квізу» (spec 002, FR-80…FR-87): the text of the material by chapters, the question editor with its
// supporting fragments, review marks, autosave of a working copy (T111 decision) and the prompt for an external model.
// Loaded as a separate chunk (FR-89). Text from the file is shown as text only (FR-69).
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Fragment, PackageQuestion, QuizPackage, UserQuiz } from '../../contracts.ts'
import {
  addQuestion, blockers, buildPrompt, chapters, DEFAULT_COUNT, deleteQuestion, editQuestion, markReviewed, moveQuestion,
  parseReply, reviewProblems, type QuestionPatch,
} from '../../core/editor.ts'
import { MAX_OPTIONS, MIN_OPTIONS } from '../../core/package.ts'
import { getUserQuiz, saveWorkingCopy } from '../../core/userQuizzes.ts'
import { quizHref } from '../../app/router.ts'
import { Icon } from '../components/icons.tsx'

type RefField = 'answer_fragment_ids' | 'feedback_fragment_ids'
type Confirm = { title: string; text: string; action: string; run: () => void }
type Notice = { kind: 'ok' | 'error'; text: string; list?: string[] }
const MAX_LISTED = 6

const shorten = (text: string, n = 90) => (Array.from(text).length > n ? `${Array.from(text).slice(0, n).join('')}…` : text)
const listed = (items: string[]) => (items.length > MAX_LISTED ? [...items.slice(0, MAX_LISTED), `… і ще ${items.length - MAX_LISTED}`] : items)

export function Editor({ quizId }: { quizId: string }) {
  const [record, setRecord] = useState<UserQuiz | null>(null)
  const [pkg, setPkg] = useState<QuizPackage | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveProblems, setSaveProblems] = useState<string[] | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [search, setSearch] = useState('')
  const initial = useRef<QuizPackage | null>(null)
  const current = useRef<QuizPackage | null>(null)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    getUserQuiz(quizId).then((stored) => {
      if (!stored) {
        setLoadError('Цього квізу немає на пристрої. Відкрийте його файл знову.')
        return
      }
      const start = stored.workingCopy ?? stored.package
      initial.current = start
      current.current = start
      setRecord(stored)
      setPkg(start)
      setSelected(start.questions[0]?.id ?? null)
    }).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [quizId])

  useEffect(() => {
    if (confirm && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [confirm])

  /** Every change is stored at once, in order (FR-84). */
  const apply = (change: (p: QuizPackage) => QuizPackage) => {
    if (!current.current) return
    const next = change(current.current)
    if (next === current.current) return
    current.current = next
    setPkg(next)
    saving.current = saving.current.then(async () => {
      const result = await saveWorkingCopy(quizId, next)
      setRecord(result.record)
      setSaveProblems(result.valid ? null : result.problems)
    }).catch((e) => setNotice({ kind: 'error', text: `Не вдалося зберегти: ${e instanceof Error ? e.message : String(e)}` }))
  }

  if (loadError) return <Shell><p class="notice is-error" role="alert">{loadError}</p></Shell>
  if (!pkg || !record) return <Shell><p class="muted" aria-busy="true">Завантаження…</p></Shell>

  const fragments = pkg.fragments ?? []
  const question = pkg.questions.find((q) => q.id === selected) ?? null
  const index = question ? pkg.questions.indexOf(question) : -1
  const problems = blockers(pkg)
  const ready = record.state === 'ready' && !record.workingCopy
  const reviewed = pkg.questions.filter((q) => q.reviewed).length

  const edit = (patch: QuestionPatch) => question && apply((p) => editQuestion(p, question.id, patch))
  const toggleRef = (field: RefField, id: string) => {
    if (!question) return
    const list = question[field] ?? []
    edit({ [field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] })
  }
  const ask = (c: Confirm) => setConfirm(c)
  const closeConfirm = () => {
    dialog.current?.close()
    setConfirm(null)
  }

  const add = () => {
    const before = current.current!.questions.length
    apply((p) => addQuestion(p))
    setSelected(current.current!.questions[before]?.id ?? null)
    setNotice(null)
  }
  const reviewAll = () => {
    const result = markReviewed(current.current!)
    if (result.ok) {
      apply(() => result.pkg)
      setNotice({ kind: 'ok', text: 'Усі питання позначено переглянутими.' })
    } else setNotice({ kind: 'error', text: 'Не всі питання можна позначити:', list: listed(result.problems) })
  }
  const reviewOne = () => {
    if (!question) return
    const result = markReviewed(current.current!, question.id)
    if (result.ok) apply(() => result.pkg)
  }

  return (
    <Shell title={pkg.meta.title}>
      <section class="settings-block" aria-labelledby="editor-state-title">
        <h2 class="title-large" id="editor-state-title">Стан</h2>
        <p class="body-medium" id="editor-counts">{`Питань: ${pkg.questions.length} · переглянуто: ${reviewed}`}</p>
        {problems.length === 0 && ready ? (
          <div class="notice is-ok" role="status" id="editor-ready">
            <p class="body-medium">Квіз готовий і є в бібліотеці.</p>
            <div class="actions"><a class="btn btn-tonal state" href={quizHref(quizId)}>Пройти квіз</a></div>
          </div>
        ) : (
          <div class="notice" id="editor-blockers">
            <p class="body-medium">Щоб квіз з'явився в бібліотеці:</p>
            <ul class="problems-plain body-medium">{listed(problems).map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        <p class="muted label-medium" id="editor-saved" aria-live="polite">
          {saveProblems ? 'Зміни збережено на пристрої як чернетку редактора: квіз ще не проходить перевірку.' : 'Зміни збережено на пристрої.'}
        </p>
        <div class="actions">
          <button type="button" class="btn btn-filled state" id="btn-add-question" onClick={add}>Додати питання</button>
          <button type="button" class="btn btn-tonal state" id="btn-review-all" onClick={reviewAll} disabled={!pkg.questions.length}>Переглянути всі</button>
          <button
            type="button" class="btn btn-text state" id="btn-revert"
            onClick={() => ask({
              title: 'Скасувати зміни?', text: 'Квіз повернеться до стану, у якому був, коли ви відкрили редактор.', action: 'Скасувати зміни',
              run: () => {
                apply(() => initial.current!)
                setSelected(initial.current!.questions[0]?.id ?? null)
                setNotice({ kind: 'ok', text: 'Зміни скасовано.' })
              },
            })}
          >Скасувати зміни</button>
        </div>
        {notice && (
          <div class={`notice ${notice.kind === 'ok' ? 'is-ok' : 'is-error'}`} role={notice.kind === 'ok' ? 'status' : 'alert'} id="editor-notice">
            <p class="body-medium">{notice.text}</p>
            {notice.list && <ul class="problems body-medium">{notice.list.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        )}
      </section>

      {pkg.questions.length > 0 && (
        <nav class="q-chips" aria-label="Питання квізу">
          {pkg.questions.map((q, i) => {
            const issues = reviewProblems(pkg, q.id).length
            const state = q.reviewed ? 'переглянуто' : issues ? `проблем: ${issues}` : 'не переглянуто'
            return (
              <button
                key={q.id} type="button" class={`q-chip state${q.reviewed ? ' is-reviewed' : ''}`} aria-current={q.id === selected ? 'true' : undefined}
                aria-label={`Питання ${i + 1}: ${q.title || 'без назви'}, ${state}`} onClick={() => setSelected(q.id)}
              >
                {q.reviewed && <Icon name="check" class="icon icon-sm" />}{i + 1}
              </button>
            )
          })}
        </nav>
      )}

      {question && (
        <QuestionForm
          pkg={pkg} question={question} index={index} fragments={fragments} edit={edit} toggleRef={toggleRef} review={reviewOne}
          move={(delta) => apply((p) => moveQuestion(p, question.id, delta))}
          remove={() => ask({
            title: `Видалити питання ${index + 1}?`, text: 'Питання зникне з квізу. Спроби, у яких на нього відповідали, лишаються в історії.', action: 'Видалити',
            run: () => {
              const next = deleteQuestion(current.current!, question.id)
              apply(() => next)
              setSelected(next.questions[Math.min(index, next.questions.length - 1)]?.id ?? null)
            },
          })}
        />
      )}

      {fragments.length > 0 && (
        <FragmentsPanel fragments={fragments} question={question} search={search} setSearch={setSearch} toggleRef={toggleRef} />
      )}
      {fragments.length > 0 && (
        <PromptPanel
          pkg={pkg}
          onReply={async (text) => {
            const result = await parseReply(current.current!, text)
            if (result.added) {
              apply(() => result.pkg)
              setSelected(result.pkg.questions[result.pkg.questions.length - result.added].id)
            }
            return result
          }}
        />
      )}

      <dialog class="modal" ref={dialog} onClose={() => setConfirm(null)} aria-labelledby="confirm-title">
        <h2 class="headline-small" id="confirm-title">{confirm?.title}</h2>
        <p class="body-medium">{confirm?.text}</p>
        <div class="actions">
          <button type="button" class="btn btn-text state" onClick={closeConfirm}>Назад</button>
          <button type="button" class="btn btn-filled state" id="btn-confirm" onClick={() => { confirm?.run(); closeConfirm() }}>{confirm?.action}</button>
        </div>
      </dialog>
    </Shell>
  )
}

function Shell({ title, children }: { title?: string; children: preact.ComponentChildren }) {
  return (
    <>
      <header class="top-app-bar" id="app-bar">
        <div class="wrap">
          <div class="bar-row">
            <a class="icon-btn bar-back state" href="#/" aria-label="До бібліотеки"><Icon name="back" /></a>
            <h1 class="bar-title title-large"><span class="bar-title-one">{title ? `Редагування: ${title}` : 'Редагування'}</span></h1>
          </div>
        </div>
      </header>
      <main class="wrap screen editor">{children}</main>
    </>
  )
}

interface FormProps {
  pkg: QuizPackage
  question: PackageQuestion
  index: number
  fragments: Fragment[]
  edit: (patch: QuestionPatch) => void
  toggleRef: (field: RefField, id: string) => void
  review: () => void
  move: (delta: -1 | 1) => void
  remove: () => void
}

function QuestionForm({ pkg, question, index, fragments, edit, toggleRef, review, move, remove }: FormProps) {
  const issues = reviewProblems(pkg, question.id)
  const byId = new Map(fragments.map((f) => [f.id, f]))
  const value = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value
  const setOption = (i: number, text: string) => edit({ options: question.options.map((o, j) => (j === i ? text : o)) })
  const removeOption = (i: number) => {
    const correct = i === question.correct ? 0 : i < question.correct ? question.correct - 1 : question.correct
    edit({ options: question.options.filter((_, j) => j !== i), correct })
  }
  const refs = (field: RefField, label: string) => (
    <div class="refs" id={`refs-${field}`}>
      <p class="label-large">{label}</p>
      {(question[field] ?? []).length ? (
        <ul class="ref-list">
          {(question[field] ?? []).map((id) => (
            <li key={id} class="ref-chip body-small">
              <span>{byId.has(id) ? shorten(byId.get(id)!.text) : `${id} (немає в матеріалі)`}</span>
              <button type="button" class="icon-btn state" aria-label={`Прибрати уривок ${id} з поля «${label}»`} onClick={() => toggleRef(field, id)}><Icon name="close" /></button>
            </li>
          ))}
        </ul>
      ) : <p class="muted body-small">Виберіть уривок у тексті матеріалу нижче.</p>}
    </div>
  )

  return (
    <section class="settings-block question-form" aria-labelledby="question-form-title">
      <h2 class="title-large" id="question-form-title">{`Питання ${index + 1} з ${pkg.questions.length}`}</h2>
      <p class="label-large" id="question-state">{question.reviewed ? 'Переглянуто' : 'Не переглянуто'}</p>
      <label class="field">
        <span class="label-large">Назва</span>
        <input type="text" value={question.title} onInput={(e) => edit({ title: value(e) })} />
      </label>
      <label class="field">
        <span class="label-large">Питання</span>
        <textarea rows={3} value={question.question} onInput={(e) => edit({ question: value(e) })} />
      </label>
      <fieldset class="field options-field">
        <legend class="label-large">Варіанти: позначте правильний</legend>
        {question.options.map((option, i) => (
          <div class="option-row" key={i}>
            <input type="radio" name={`correct-${question.id}`} checked={question.correct === i} aria-label={`Варіант ${i + 1} правильний`} onChange={() => edit({ correct: i })} />
            <input type="text" value={option} aria-label={`Варіант ${i + 1}`} onInput={(e) => setOption(i, value(e))} />
            {question.options.length > MIN_OPTIONS && (
              <button type="button" class="icon-btn state" aria-label={`Видалити варіант ${i + 1}`} onClick={() => removeOption(i)}><Icon name="close" /></button>
            )}
          </div>
        ))}
        {question.options.length < MAX_OPTIONS && (
          <button type="button" class="btn btn-text state" onClick={() => edit({ options: [...question.options, ''] })}>Додати варіант</button>
        )}
      </fieldset>
      <label class="field">
        <span class="label-large">Пояснення правильної відповіді</span>
        <textarea rows={3} value={question.feedback} onInput={(e) => edit({ feedback: value(e) })} />
      </label>
      {fragments.length > 0 && refs('answer_fragment_ids', 'Опора відповіді')}
      {fragments.length > 0 && refs('feedback_fragment_ids', 'Опора пояснення')}
      {issues.length > 0 && (
        <div class="notice" id="question-problems">
          <p class="body-medium">Щоб позначити переглянутим:</p>
          <ul class="problems-plain body-medium">{issues.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div class="actions">
        <button type="button" class="btn btn-filled state" id="btn-review" disabled={question.reviewed || issues.length > 0} onClick={review}>Позначити переглянутим</button>
        <button type="button" class="btn btn-text state" disabled={index === 0} onClick={() => move(-1)}>Вище</button>
        <button type="button" class="btn btn-text state" disabled={index === pkg.questions.length - 1} onClick={() => move(1)}>Нижче</button>
        <button type="button" class="btn btn-text state" id="btn-delete-question" onClick={remove}>Видалити питання</button>
      </div>
    </section>
  )
}

function FragmentsPanel({ fragments, question, search, setSearch, toggleRef }: {
  fragments: Fragment[]; question: PackageQuestion | null; search: string; setSearch: (s: string) => void
  toggleRef: (field: RefField, id: string) => void
}) {
  const needle = search.trim().toLowerCase()
  const shown = needle ? fragments.filter((f) => f.text.toLowerCase().includes(needle) || f.chapter.toLowerCase().includes(needle)) : fragments
  const groups = new Map<string, Fragment[]>()
  for (const f of shown) groups.set(f.chapter, [...(groups.get(f.chapter) ?? []), f])
  return (
    <section class="settings-block" aria-labelledby="fragments-title">
      <h2 class="title-large" id="fragments-title">Текст матеріалу</h2>
      <label class="field">
        <span class="label-large">Пошук у тексті</span>
        <input type="search" value={search} onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)} />
      </label>
      {!shown.length && <p class="muted body-medium">Нічого не знайдено.</p>}
      {[...groups].map(([chapter, list]) => (
        <div class="chapter" key={chapter}>
          <h3 class="title-medium">{chapter || 'Без розділу'}</h3>
          {list.map((f) => {
            const inAnswer = question?.answer_fragment_ids?.includes(f.id) ?? false
            const inFeedback = question?.feedback_fragment_ids?.includes(f.id) ?? false
            return (
              <div class="fragment" key={f.id} data-fragment={f.id}>
                <p class="body-medium">{f.text}</p>
                {question && (
                  <div class="actions">
                    <button type="button" class="btn btn-outlined state" aria-pressed={inAnswer} onClick={() => toggleRef('answer_fragment_ids', f.id)}>Опора відповіді</button>
                    <button type="button" class="btn btn-outlined state" aria-pressed={inFeedback} onClick={() => toggleRef('feedback_fragment_ids', f.id)}>Опора пояснення</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </section>
  )
}

function PromptPanel({ pkg, onReply }: { pkg: QuizPackage; onReply: (text: string) => Promise<{ added: number; problems: string[]; warning: string }> }) {
  const all = chapters(pkg)
  const [chosen, setChosen] = useState<string[]>(all.map((c) => c.title))
  const [count, setCount] = useState(DEFAULT_COUNT)
  const [prompt, setPrompt] = useState<{ copied: boolean; text: string; chars: number } | { problem: string } | null>(null)
  const [reply, setReply] = useState('')
  const [result, setResult] = useState<Notice | null>(null)
  const manual = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (prompt && 'text' in prompt && !prompt.copied) manual.current?.select()
  }, [prompt])

  const copy = async () => {
    const built = buildPrompt(pkg, { chosen, count })
    if (!built.ok) {
      setPrompt({ problem: built.problem })
      return
    }
    let copied = false
    try {
      await navigator.clipboard.writeText(built.text)
      copied = true
    } catch {
      copied = false
    }
    setPrompt({ copied, text: built.text, chars: built.chars })
  }

  const add = async () => {
    const r = await onReply(reply)
    const lines = [...r.problems]
    if (r.warning) lines.unshift(`Модель повідомила: ${r.warning}`)
    setResult(r.added
      ? { kind: 'ok', text: `Додано питань: ${r.added}. Перевірте їх і позначте переглянутими.`, list: lines.length ? listed(lines) : undefined }
      : { kind: 'error', text: 'Жодного питання не додано.', list: listed(lines) })
    if (r.added) setReply('')
  }

  return (
    <section class="settings-block" aria-labelledby="prompt-title">
      <h2 class="title-large" id="prompt-title">Питання зі ШІ</h2>
      <p class="body-medium">Застосунок не звертається до моделей. Скопіюйте промпт у ChatGPT чи NotebookLM, а відповідь вставте нижче: питання додадуться непереглянутими.</p>
      <fieldset class="field">
        <legend class="label-large">Розділи</legend>
        {all.map((c) => (
          <label class="check-row body-medium" key={c.title}>
            <input
              type="checkbox" checked={chosen.includes(c.title)}
              onChange={(e) => setChosen((e.currentTarget as HTMLInputElement).checked ? [...chosen, c.title] : chosen.filter((t) => t !== c.title))}
            />
            <span>{`${c.title || 'Без розділу'} · ${c.chars} символів`}</span>
          </label>
        ))}
      </fieldset>
      <label class="field field-narrow">
        <span class="label-large">Кількість питань</span>
        <input type="number" min={1} max={200} value={count} onInput={(e) => setCount(Number((e.currentTarget as HTMLInputElement).value))} />
      </label>
      <div class="actions">
        <button type="button" class="btn btn-tonal state" id="btn-copy-prompt" onClick={copy}>Скопіювати промпт</button>
      </div>
      {prompt && 'problem' in prompt && <p class="notice is-error" role="alert" id="prompt-problem">{prompt.problem}</p>}
      {prompt && 'text' in prompt && prompt.copied && <p class="notice is-ok" role="status" id="prompt-copied">{`Промпт скопійовано: ${prompt.chars} символів тексту.`}</p>}
      {prompt && 'text' in prompt && !prompt.copied && (
        <label class="field">
          <span class="label-large">Буфер обміну недоступний: скопіюйте промпт вручну</span>
          <textarea ref={manual} id="prompt-text" rows={6} readOnly value={prompt.text} />
        </label>
      )}
      <label class="field">
        <span class="label-large">Відповідь моделі</span>
        <textarea id="reply-text" rows={6} value={reply} onInput={(e) => setReply((e.currentTarget as HTMLTextAreaElement).value)} />
      </label>
      <div class="actions">
        <button type="button" class="btn btn-filled state" id="btn-add-reply" disabled={!reply.trim()} onClick={add}>Додати питання з відповіді</button>
      </div>
      {result && (
        <div class={`notice ${result.kind === 'ok' ? 'is-ok' : 'is-error'}`} role={result.kind === 'ok' ? 'status' : 'alert'} id="reply-result">
          <p class="body-medium">{result.text}</p>
          {result.list && <ul class="problems-plain body-medium">{result.list.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}
    </section>
  )
}
