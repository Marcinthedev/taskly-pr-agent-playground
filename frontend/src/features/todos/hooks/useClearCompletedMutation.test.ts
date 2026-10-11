import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createTestQueryClient, queryWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useClearCompletedMutation } from './useClearCompletedMutation'

vi.mock('../api/todos', () => ({ todosApi: { clearCompleted: vi.fn() } }))

it('clears completed tasks and keeps only active ones in the cached list', async () => {
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })
  const active = { ...todoFixture, id: 1, title: 'Active task', completed: false }
  const done = { ...todoFixture, id: 2, title: 'Done task', completed: true }
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [active, done])
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

it('leaves the cache empty-handed when no list is cached', async () => {
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 0 })
  const client = createTestQueryClient()
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() => result.current.mutateAsync())

  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('keeps the cache when the server fails', async () => {
  vi.mocked(todosApi.clearCompleted).mockRejectedValue(new Error('Server down.'))
  const done = { ...todoFixture, completed: true }
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [done])
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() =>
    expect(result.current.mutateAsync()).rejects.toThrow('Server down.'),
  )

  expect(client.getQueryData(todoKeys.list)).toEqual([done])
})
