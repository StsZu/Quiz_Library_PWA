// Persistent storage (spec FR-42): asked once on the first launch from the home screen.
import { getMeta, setMeta } from '../core/storage/db.ts'
import { isStandalone } from './install.tsx'

export type Persistence = 'granted' | 'denied' | 'unsupported'

export async function persistence(): Promise<Persistence> {
  if (!navigator.storage?.persisted) return 'unsupported'
  return (await navigator.storage.persisted()) ? 'granted' : 'denied'
}

export async function requestPersistence(): Promise<Persistence> {
  if (!navigator.storage?.persist) return 'unsupported'
  return (await navigator.storage.persist()) ? 'granted' : 'denied'
}

export async function askOnFirstStandaloneLaunch() {
  if (!isStandalone() || (await getMeta('persistAsked'))) return
  await setMeta('persistAsked', true)
  await requestPersistence()
}
