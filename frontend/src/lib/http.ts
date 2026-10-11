export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const existingHeaders =
    init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : Object.fromEntries(
          Object.entries(init.headers ?? {}).map(([key, value]) => [
            key,
            String(value),
          ]),
        )

  const hasJsonBody =
    init.body !== undefined &&
    init.body !== null &&
    !(init.body instanceof FormData)
  const hasContentType = Object.keys(existingHeaders).some(
    (key) => key.toLowerCase() === 'content-type',
  )
  const headers: Record<string, string> = { ...existingHeaders }
  if (hasJsonBody && !hasContentType) {
    headers['Content-Type'] = 'application/json'
  }

  const requestInit: RequestInit = {
    ...init,
    headers,
  }

  let response: Response
  try {
    response = await fetch(`/api${path}`, requestInit)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new Error('Cannot connect to the server. Please try again.')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)

    if (response.status === 422) {
      throw new Error(
        'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
      )
    }

    throw new Error(
      typeof body?.detail === 'string'
        ? body.detail
        : 'The operation failed. Please try again.',
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}
