import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const file = (name: string) => readFileSync(resolve(__dirname, '../../public/content', name), 'utf8')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('content loader', () => {
  it('loads the index and a quiz once, then from memory', async () => {
    const fetchMock = vi.fn(async (url: URL) => new Response(file(String(url).split('/content/')[1])))
    vi.stubGlobal('fetch', fetchMock)
    const { loadIndex, loadQuiz } = await import('../../src/core/content.ts')
    expect((await loadIndex()).courses).toHaveLength(3)
    expect((await loadQuiz('chysta-chastota-ep01')).questions).toHaveLength(10)
    await loadQuiz('chysta-chastota-ep01')
    await loadIndex()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a failed request and retries next time', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const { loadIndex, loadQuiz } = await import('../../src/core/content.ts')
    await expect(loadIndex()).rejects.toThrow('404')
    await expect(loadQuiz('missing')).rejects.toThrow('missing.json')
    await expect(loadIndex()).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
