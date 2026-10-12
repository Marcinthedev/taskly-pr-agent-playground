import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createTestQueryClient, queryWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useClearCompletedMutation } from './useClearCompletedMutation'

vi.mock('../api/todos', () => ({ todosApi: { clearCompleted: vi.fn() } }))

it('clears completed tasks and drops them from the cached list', async () => {
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })
  const done = { ...todoFixture, id: 1, completed: true }
  const active = { ...todoFixture, id: 2, completed: false }
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [done, active])
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper: queryWrapper(client),
  })

  let response: { deleted: number } | undefined
  await act(async () => {
    response = await result.current.mutateAsync()
  })

  expect(response).toEqual({ deleted: 1 })
  expect(client.getQueryData(todoKeys.list)).toEqual([active])
})

it('keeps the cache when the server fails to clear', async () => {
  vi.mocked(todosApi.clearCompleted).mockRejectedValue(
    new Error('The server is unavailable.'),
  )
  const done = { ...todoFixture, completed: true }
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [done])
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() =>
    expect(result.current.mutateAsync()).rejects.toThrow(
      'The server is unavailable.',
    ),
  )

  expect(client.getQueryData(todoKeys.list)).toEqual([done])
})
