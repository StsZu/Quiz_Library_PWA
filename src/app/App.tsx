import { route } from './router.ts'
import { Library } from '../ui/library/Library.tsx'
import { QuizScreen } from '../ui/quiz/QuizScreen.tsx'
import { Settings } from '../ui/settings/Settings.tsx'

export function App() {
  const current = route.value
  if (current.name === 'quiz') return <QuizScreen key={`${current.quizId}|${current.mode}`} quizId={current.quizId} mode={current.mode} />
  if (current.name === 'settings') return <Settings />
  return <Library />
}
