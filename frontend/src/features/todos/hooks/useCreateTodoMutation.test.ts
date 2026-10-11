import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createTestQueryClient, queryWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { create: vi.fn() } }))

const existing = { ...todoFixture, id: 1, title: 'Existing task' }
const input = {
  title: 'Prepare a demo',
  description: '',
  priority: 'medium' as const,
  due_date: null,
  completed: false,
}

it('creates the task and puts it first in the cached list', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [existing])
  const { result } = renderHook(() => useCreateTodoMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() => result.current.mutateAsync(input))

  expect(todosApi.create).toHaveBeenCalledWith(input)
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, existing])
})

it('does not duplicate a task that a refetch already cached', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [todoFixture, existing])
  const { result } = renderHook(() => useCreateTodoMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() => result.current.mutateAsync(input))

  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, existing])
})

it('starts a list when none was cached yet', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
  const client = createTestQueryClient()
  const { result } = renderHook(() => useCreateTodoMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() => result.current.mutateAsync(input))

  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
