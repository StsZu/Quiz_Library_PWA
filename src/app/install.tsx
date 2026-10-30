// Install hint for Safari, which has no install prompt (spec FR-52).
import { useEffect, useState } from 'preact/hooks'
import { getMeta, setMeta } from '../core/storage/db.ts'

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export function InstallSteps() {
  return (
    <ul class="body-medium">
      <li>iPhone та iPad (Safari): «Поділитися» → «На початковий екран» → «Додати».</li>
      <li>Mac (Safari): «Файл» → «Додати в Dock».</li>
      <li>Chrome чи Edge: значок встановлення в адресному рядку.</li>
      <li>Прогрес з вкладки браузера у встановлений застосунок не переходить: перенесіть його експортом та імпортом.</li>
    </ul>
  )
}

export function InstallBanner() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (isStandalone()) return
    getMeta('installHintDismissed').then((dismissed) => setShow(!dismissed)).catch(() => setShow(false))
  }, [])
  if (!show) return null
  const dismiss = () => {
    setShow(false)
    setMeta('installHintDismissed', true)
  }
  return (
    <div class="banner" role="region" aria-label="Встановлення" id="install-banner">
      <p class="body-medium">Встановіть «Мої квізи» на головний екран: так квізи відкриватимуться без мережі, а прогрес зберігатиметься надійніше. Як — у налаштуваннях.</p>
      <a class="btn btn-text state" href="#/settings">Як встановити</a>
      <button type="button" class="btn btn-text state" onClick={dismiss}>Зрозуміло</button>
    </div>
  )
}
