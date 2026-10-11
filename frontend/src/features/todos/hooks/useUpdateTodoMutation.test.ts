import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createTestQueryClient, queryWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { update: vi.fn() } }))

const other = { ...todoFixture, id: 1, title: 'Other task' }

it('sends the change and replaces the task in the cached list', async () => {
  const saved = { ...todoFixture, completed: true }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const client = createTestQueryClient()
  client.setQueryData(todoKeys.list, [todoFixture, other])
  const { result } = renderHook(() => useUpdateTodoMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() =>
    result.current.mutateAsync({
      id: todoFixture.id,
      input: { completed: true },
    }),
  )

  expect(todosApi.update).toHaveBeenCalledWith(todoFixture.id, {
    completed: true,
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, other])
})

it('leaves an empty cache untouched', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const client = createTestQueryClient()
  const { result } = renderHook(() => useUpdateTodoMutation(), {
    wrapper: queryWrapper(client),
  })

  await act(() =>
    result.current.mutateAsync({ id: todoFixture.id, input: { title: 'x' } }),
  )

  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})
