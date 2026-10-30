// Banners on the library: the update offer (FR-51, never shown during a quiz) and the install hint (FR-52).
import { InstallBanner } from '../../app/install.tsx'
import { pendingUpdate } from '../../app/update.ts'

export function Banners() {
  const apply = pendingUpdate.value
  return (
    <>
      {apply && (
        <div class="banner" role="region" aria-label="Оновлення" id="update-banner">
          <p class="body-medium">Доступна нова версія.</p>
          <button type="button" class="btn btn-filled state" onClick={apply}>Оновити</button>
        </div>
      )}
      <InstallBanner />
    </>
  )
}
