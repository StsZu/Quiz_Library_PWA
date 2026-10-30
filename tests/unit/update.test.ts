import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingUpdate, watchUpdates } from '../../src/app/update.ts'

class FakeWorker extends EventTarget {
  state = 'installing'
  postMessage = vi.fn()
  set(state: string) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

function setup(controller: object | null) {
  const registration = Object.assign(new EventTarget(), { waiting: null as FakeWorker | null, installing: null as FakeWorker | null, update: vi.fn(() => Promise.resolve()) })
  const container = Object.assign(new EventTarget(), { controller })
  const reload = vi.fn()
  watchUpdates(registration as unknown as ServiceWorkerRegistration, container as unknown as ServiceWorkerContainer, reload)
  return { registration, container, reload }
}

beforeEach(() => { pendingUpdate.value = null })

describe('watchUpdates (FR-51)', () => {
  it('offers an installed worker as an update and reloads only after the user applies it', () => {
    const { registration, container, reload } = setup({})
    const worker = new FakeWorker()
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    expect(pendingUpdate.value).toBeNull()
    worker.set('installed')
    expect(pendingUpdate.value).toBeTypeOf('function')
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
    pendingUpdate.value!()
    expect(worker.postMessage).toHaveBeenCalledWith('skipWaiting')
    container.dispatchEvent(new Event('controllerchange'))
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not offer the first install, when nothing controls the page yet', () => {
    const { registration } = setup(null)
    const worker = new FakeWorker()
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    worker.set('installed')
    expect(pendingUpdate.value).toBeNull()
  })

  it('checks for a new version when the app comes back to the foreground', () => {
    const { registration } = setup({})
    document.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalled()
  })
})
