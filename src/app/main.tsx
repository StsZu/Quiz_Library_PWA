import { render } from 'preact'
import { App } from './App.tsx'
import '../ui/theme/tokens.css'
import '../ui/theme/app.css'
import { askOnFirstStandaloneLaunch } from './persist.ts'
import { registerServiceWorker } from './update.ts'

render(<App />, document.getElementById('app')!)

askOnFirstStandaloneLaunch()
registerServiceWorker()
