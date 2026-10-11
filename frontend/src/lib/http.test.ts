import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from './http'

describe('request', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns parsed JSON for successful requests', async () => {
    const payload = { ok: true, id: 1 }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    })

    await expect(request('/todos')).resolves.toEqual(payload)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/todos', {
      headers: {},
    })
  })

  it('lets the browser set the multipart boundary for FormData bodies', async () => {
    const body = new FormData()
    body.append('file', 'content')
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    await request('/upload', { method: 'POST', body })

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/upload', {
      method: 'POST',
      body,
      headers: {},
    })
  })

  it('keeps a caller-provided content type', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    await request('/todos', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'text/plain' }),
      body: 'raw',
    })

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/todos', {
      method: 'POST',
      body: 'raw',
      headers: { 'content-type': 'text/plain' },
    })
  })

  it('uses the server detail message for non-validation errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Task not found.' }),
    })

    await expect(request('/todos/9')).rejects.toThrow('Task not found.')
  })

  it('falls back to a generic message when the error body is unusable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })

    await expect(request('/todos')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
  })

  it('rethrows the abort error when the caller cancelled the request', async () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = new DOMException('Aborted', 'AbortError')
    globalThis.fetch = vi.fn().mockRejectedValue(abortError)

    await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
      abortError,
    )
  })

  it('surfaces validation details in a friendly message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: 'Task title is required.' }),
    })

    await expect(request('/todos')).rejects.toThrow(
      'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
    )
  })

  it('throws when the server is unavailable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down'))

    await expect(request('/todos')).rejects.toThrow(
      'Cannot connect to the server. Please try again.',
    )
  })

  it('returns undefined for 204 no-content responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: vi.fn(),
    })

    await expect(
      request('/todos/1', { method: 'DELETE' }),
    ).resolves.toBeUndefined()
  })

  it('preserves custom headers and abort signals', async () => {
    const controller = new AbortController()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    await request('/todos', {
      method: 'POST',
      headers: { Authorization: 'Bearer demo' },
      signal: controller.signal,
      body: JSON.stringify({ title: 'Task' }),
    })

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/todos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer demo',
      },
      signal: controller.signal,
      body: JSON.stringify({ title: 'Task' }),
    })
  })
})
