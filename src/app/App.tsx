import { useEffect, useState } from 'preact/hooks'
import type { FunctionComponent } from 'preact'
import { route } from './router.ts'
import { Library } from '../ui/library/Library.tsx'
import { QuizScreen } from '../ui/quiz/QuizScreen.tsx'
import { Settings } from '../ui/settings/Settings.tsx'

type EditorProps = { quizId: string }
let editorModule: Promise<FunctionComponent<EditorProps>> | null = null

/** Spec 002, FR-89: the editor is a separate chunk loaded only on #/edit/<id> (it is still precached for offline use). */
function LazyEditor({ quizId }: EditorProps) {
  const [Editor, setEditor] = useState<FunctionComponent<EditorProps> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    editorModule ??= import('../ui/editor/Editor.tsx').then((m) => m.Editor)
    editorModule.then((component) => setEditor(() => component)).catch((e) => {
      editorModule = null
      setError(e instanceof Error ? e.message : String(e))
    })
  }, [])
  if (error) return <main class="wrap screen"><p class="notice is-error" role="alert">{`Не вдалося відкрити редактор: ${error}`}</p></main>
  if (!Editor) return <main class="wrap screen"><p class="muted" aria-busy="true">Відкриваю редактор…</p></main>
  return <Editor quizId={quizId} />
}

export function App() {
  const current = route.value
  if (current.name === 'quiz') return <QuizScreen key={`${current.quizId}|${current.mode}`} quizId={current.quizId} mode={current.mode} />
  if (current.name === 'settings') return <Settings />
  if (current.name === 'edit') return <LazyEditor key={current.quizId} quizId={current.quizId} />
  return <Library />
}
