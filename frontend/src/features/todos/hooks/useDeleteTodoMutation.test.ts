import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createTestQueryClient, queryWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { remove: vi.fn() } }))

it('deletes the task and drops it from the cached list', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const other = { ...todoFixture, id: 1, title: 'Other task' }
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [todoFixture, other])
  const { result } = renderHook(() => useDeleteTodoMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() => result.current.mutateAsync(todoFixture.id))

  expect(todosApi.remove).toHaveBeenCalledWith(todoFixture.id)
  expect(client.getQueryData(todoKeys.list)).toEqual([other])
})

it('keeps the cache when the server refuses the deletion', async () => {
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Task not found.'))
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [todoFixture])
  const { result } = renderHook(() => useDeleteTodoMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() =>
    expect(result.current.mutateAsync(todoFixture.id)).rejects.toThrow(
      'Task not found.',
    ),
  )

  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
