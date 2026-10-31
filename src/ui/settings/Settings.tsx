// Settings: export and import of progress, persistent storage, install hint, version and attempts per quiz
// (spec FR-40…FR-42, FR-52, FR-53; spec 002, FR-90…FR-92: quizzes from disk travel in the same file).
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Attempt, ContentIndex, UserQuiz } from '../../contracts.ts'
import { allAttempts } from '../../core/attempts.ts'
import { buildExport, exportFileName, planMerge, replaceProgress, validateImport, type MergePlan } from '../../core/backup.ts'
import { loadIndex } from '../../core/content.ts'
import { listUserQuizzes } from '../../core/userQuizzes.ts'
import { InstallSteps } from '../../app/install.tsx'
import { persistence, requestPersistence, type Persistence } from '../../app/persist.ts'
import { Icon } from '../components/icons.tsx'

async function download(attempts: Attempt[]) {
  const userQuizzes = await listUserQuizzes()
  const blob = new Blob([JSON.stringify(buildExport(attempts, __APP_VERSION__, new Date(), userQuizzes), null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = exportFileName()
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const persistenceText: Record<Persistence, string> = {
  granted: 'Постійне сховище надано: браузер не видалятиме дані сам.',
  denied: 'Браузер не надав постійного сховища. Дані можуть зникнути разом із застосунком — робіть експорт.',
  unsupported: 'Браузер не підтримує запит постійного сховища. Робіть експорт.',
}

export function Settings() {
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [index, setIndex] = useState<ContentIndex | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState<{ attempts: Attempt[]; userQuizzes: UserQuiz[]; merge: MergePlan } | null>(null)
  const [storage, setStorage] = useState<Persistence | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = () => allAttempts().then(setAttempts)
  useEffect(() => {
    refresh()
    loadIndex().then(setIndex).catch(() => setIndex(null))
    persistence().then(setStorage)
  }, [])

  useEffect(() => {
    if (pending && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [pending])

  const onFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    setMessage(null)
    if (!file) return
    const result = await validateImport(await file.text(), file.size)
    if (!result.ok) {
      setProblems(result.problems)
      return
    }
    setProblems([])
    setPending({ attempts: result.attempts, userQuizzes: result.userQuizzes, merge: await planMerge(result.userQuizzes) })
  }

  const closeDialog = () => {
    dialog.current?.close()
    setPending(null)
  }

  const confirmImport = async () => {
    if (!pending) return
    const merged = await replaceProgress(pending.attempts, pending.userQuizzes)
    const quizzes = pending.userQuizzes.length ? ` Квізи з диска: додано ${merged.added}, оновлено ${merged.updated}.` : ''
    setMessage(`Прогрес замінено: спроб ${pending.attempts.length}.${quizzes}`)
    closeDialog()
    refresh()
  }

  const counts = new Map<string, { full: number; mistakes: number }>()
  for (const a of attempts) {
    const entry = counts.get(a.quizId) ?? { full: 0, mistakes: 0 }
    entry[a.mode] += 1
    counts.set(a.quizId, entry)
  }

  return (
    <>
      <header class="top-app-bar" id="app-bar">
        <div class="wrap">
          <div class="bar-row">
            <a class="icon-btn bar-back state" href="#/" aria-label="До бібліотеки"><Icon name="back" /></a>
            <h1 class="bar-title title-large">Налаштування</h1>
          </div>
        </div>
      </header>
      <main class="wrap screen">
        <section class="settings-block" aria-labelledby="backup-title">
          <h2 class="title-large" id="backup-title">Прогрес</h2>
          <p class="body-medium">Спроби зберігаються лише на цьому пристрої. Щоб перенести їх на інший пристрій або зберегти копію, експортуйте файл, а потім імпортуйте його.</p>
          <div class="actions">
            <button type="button" class="btn btn-filled state" id="btn-export" onClick={() => download(attempts)}>Експортувати прогрес</button>
            <button type="button" class="btn btn-outlined state" id="btn-import" onClick={() => fileInput.current?.click()}>Імпортувати з файлу</button>
            <input ref={fileInput} class="visually-hidden-input" type="file" accept="application/json,.json" aria-label="Файл експорту" tabIndex={-1} onChange={onFile} data-testid="import-file" />
          </div>
          {problems.length > 0 && (
            <div class="notice is-error" role="alert">
              <p class="title-medium">Файл не імпортовано. Дані не змінено.</p>
              <ul class="problems body-medium">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {message && <p class="notice is-ok" role="status">{message}</p>}
        </section>

        <section class="settings-block" aria-labelledby="storage-title">
          <h2 class="title-large" id="storage-title">Сховище</h2>
          <p class="body-medium" id="storage-state">{storage ? persistenceText[storage] : 'Перевіряю…'}</p>
          {storage === 'denied' && (
            <div class="actions">
              <button type="button" class="btn btn-tonal state" onClick={() => requestPersistence().then(setStorage)}>Попросити ще раз</button>
            </div>
          )}
        </section>

        <section class="settings-block" aria-labelledby="install-title">
          <h2 class="title-large" id="install-title">Встановлення</h2>
          <InstallSteps />
        </section>

        <section class="settings-block" aria-labelledby="stats-title">
          <h2 class="title-large" id="stats-title">Спроби за квізами</h2>
          <table class="stats body-medium">
            <thead><tr><th>Квіз</th><th class="num">Спроб</th><th class="num">Помилки</th></tr></thead>
            <tbody>
              {index?.courses.flatMap((c) => c.quizzes).map((q) => (
                <tr key={q.id}><td>{q.title}</td><td class="num">{counts.get(q.id)?.full ?? 0}</td><td class="num">{counts.get(q.id)?.mistakes ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <p class="muted label-medium" id="app-version">{`Версія ${__APP_VERSION__}`}</p>
      </main>

      <dialog class="modal" ref={dialog} onClose={() => setPending(null)} aria-labelledby="import-dialog-title">
        <h2 class="headline-small" id="import-dialog-title">Замінити прогрес?</h2>
        <p class="body-medium">{`Файл містить спроб: ${pending?.attempts.length ?? 0}. Поточні спроби на цьому пристрої (${attempts.length}) буде замінено.`}</p>
        {pending && pending.userQuizzes.length > 0 && (
          <p class="body-medium" id="import-dialog-quizzes">{`Квізи з диска: додати ${pending.merge.added}, оновити ${pending.merge.updated}, лишити без змін ${pending.merge.kept}. Жоден квіз не буде видалено.`}</p>
        )}
        <div class="actions">
          <button type="button" class="btn btn-text state" onClick={closeDialog}>Скасувати</button>
          <button type="button" class="btn btn-outlined state" onClick={() => download(attempts)}>Спершу експортувати поточний</button>
          <button type="button" class="btn btn-filled state" id="btn-confirm-import" onClick={confirmImport}>Замінити</button>
        </div>
      </dialog>
    </>
  )
}
