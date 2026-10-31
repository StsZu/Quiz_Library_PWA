// Opening a quiz file from disk (spec 002, FR-60, FR-62, FR-64, FR-65, FR-67): the button in the app bar, the
// problems or the result above the library and the «Додати» / «Оновити квіз» dialog. Nothing is stored before the
// person confirms; an invalid file changes nothing.
import { signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { ReadResult } from '../../contracts.ts'
import { persistence, requestPersistence } from '../../app/persist.ts'
import { decodeUtf8, MAX_FILE_BYTES, readPackage } from '../../core/package.ts'
import { MY_FILES, planImport, saveUserQuiz, type ImportPlan } from '../../core/userQuizzes.ts'
import { quizHref } from '../../app/router.ts'
import { Icon } from '../components/icons.tsx'

type ReadOk = Extract<ReadResult, { ok: true }>
type Confirm = { phase: 'confirm'; fileName: string; result: ReadOk; plan: Exclude<ImportPlan, { kind: 'same' }> }
type State =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'problems'; fileName: string; problems: string[] }
  | { phase: 'done'; message: string; quizId?: string }
  | Confirm

const MAX_WARNINGS = 10
export const openFileState = signal<State>({ phase: 'idle' })
const input = signal<HTMLInputElement | null>(null)

export async function openFile(file: File): Promise<void> {
  openFileState.value = { phase: 'reading' }
  const fail = (problems: string[]) => { openFileState.value = { phase: 'problems', fileName: file.name, problems } }
  if (file.size > MAX_FILE_BYTES) return fail([`Файл завеликий: ${Math.ceil(file.size / 1024)} КБ, допустимо до ${MAX_FILE_BYTES / 1024 / 1024} МБ`])
  const decoded = decodeUtf8(await file.arrayBuffer())
  if (!decoded.ok) return fail([decoded.problem])
  const result = await readPackage(decoded.text, file.name, file.size)
  if (!result.ok) return fail(result.problems)
  const plan = await planImport(result)
  if (plan.kind === 'same') {
    openFileState.value = { phase: 'done', message: `Цей квіз уже додано: «${result.package.meta.title}». Нічого не змінено.` }
    return
  }
  openFileState.value = { phase: 'confirm', fileName: file.name, result, plan }
}

/** Icon button for the app bar; the file input lives here so the system picker opens from a direct tap (iOS). */
export function OpenFileButton() {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.value = ref.current
    return () => { input.value = null }
  }, [])
  const onChange = (event: Event) => {
    const element = event.currentTarget as HTMLInputElement
    const file = element.files?.[0]
    element.value = ''
    if (file) void openFile(file)
  }
  return (
    <>
      <button type="button" class="icon-btn state" id="btn-open-file" aria-label="Відкрити файл квізу" onClick={() => ref.current?.click()}>
        <Icon name="open" />
      </button>
      <input ref={ref} class="visually-hidden-input" type="file" accept=".json,application/json" tabIndex={-1} aria-hidden="true" onChange={onChange} data-testid="open-file" />
    </>
  )
}

function stateLine(result: ReadOk): string {
  const total = result.package.questions.length
  if (result.state === 'material') return 'Матеріал без питань: питання можна буде створити з його тексту'
  if (result.state === 'draft') return `Чернетка: переглянуто ${result.package.questions.filter((q) => q.reviewed).length} з ${total} питань`
  return `Питань: ${total}`
}

/** Problems, the result message and the confirmation dialog, shown above the library. */
export function OpenFilePanel({ builtIn, onSaved }: { builtIn: Map<string, string>; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const state = openFileState.value
  const confirm = state.phase === 'confirm' ? state : null

  useEffect(() => {
    if (confirm && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [confirm])

  // Messages belong to this visit of the library: leaving it clears them.
  useEffect(() => () => { openFileState.value = { phase: 'idle' } }, [])

  const cancel = () => {
    dialog.current?.close()
    openFileState.value = { phase: 'idle' }
  }

  const save = async () => {
    if (!confirm) return
    const { result, fileName, plan } = confirm
    await saveUserQuiz(result, fileName)
    let storage = await persistence()
    if (storage === 'denied') storage = await requestPersistence()
    const verb = plan.kind === 'update' ? 'оновлено' : 'додано'
    const hint = storage === 'granted' ? '' : ' Квізи з диска зберігаються лише на цьому пристрої: робіть експорт прогресу в налаштуваннях.'
    dialog.current?.close()
    openFileState.value = { phase: 'done', message: `Квіз «${result.package.meta.title}» ${verb}.${hint}`, quizId: result.quiz ? result.id : undefined }
    onSaved()
  }

  const result = confirm?.result
  const pkg = result?.package
  const copyOf = result ? builtIn.get(result.fileSlug) : undefined
  const warnings = result?.warnings ?? []
  const diff = confirm?.plan.kind === 'update' ? confirm.plan.diff : null

  return (
    <>
      {state.phase === 'reading' && <p class="muted" aria-busy="true">Читаю файл…</p>}
      {state.phase === 'problems' && (
        <div class="notice is-error" role="alert" id="open-file-problems">
          <p class="title-medium">{`Файл «${state.fileName}» не відкрито. Дані не змінено.`}</p>
          <ul class="problems body-medium">{state.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {state.phase === 'done' && (
        <div class="notice is-ok" role="status" id="open-file-message">
          <p class="body-medium">{state.message}</p>
          {state.quizId && <div class="actions"><a class="btn btn-tonal state" href={quizHref(state.quizId)}>Почати квіз</a></div>}
        </div>
      )}

      <dialog class="modal" ref={dialog} onClose={() => { if (openFileState.value.phase === 'confirm') openFileState.value = { phase: 'idle' } }} aria-labelledby="open-dialog-title">
        {pkg && result && (
          <>
            <h2 class="headline-small" id="open-dialog-title">{diff ? 'Оновити квіз?' : 'Додати квіз?'}</h2>
            <dl class="file-facts body-medium">
              <dt>Назва</dt><dd>{pkg.meta.title}</dd>
              <dt>Мова</dt><dd>{pkg.meta.lang}</dd>
              <dt>Курс</dt><dd>{(pkg.course ?? MY_FILES).title}</dd>
              <dt>Вміст</dt><dd>{stateLine(result)}</dd>
            </dl>
            {diff && (
              <p class="body-medium" id="open-diff">{`Нових питань: ${diff.added} · змінених: ${diff.changed} · вилучених: ${diff.removed} · без змін: ${diff.unchanged}. Спроби лишаються в історії.`}</p>
            )}
            {copyOf && <p class="body-medium" id="open-copy">{`Цей квіз уже є в курсі «${copyOf}». Буде додано окрему копію з диска.`}</p>}
            {warnings.length > 0 && (
              <div class="body-medium" id="open-warnings">
                <p>Попередження (квіз відкриється):</p>
                <ul class="file-warnings">
                  {warnings.slice(0, MAX_WARNINGS).map((w, i) => <li key={i}>{w.message}</li>)}
                  {warnings.length > MAX_WARNINGS && <li>{`… і ще ${warnings.length - MAX_WARNINGS}`}</li>}
                </ul>
              </div>
            )}
            <div class="actions">
              <button type="button" class="btn btn-text state" onClick={cancel}>Скасувати</button>
              <button type="button" class="btn btn-filled state" id="btn-confirm-open" onClick={save}>{diff ? 'Оновити' : 'Додати'}</button>
            </div>
          </>
        )}
      </dialog>
    </>
  )
}
