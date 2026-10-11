import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createTestQueryClient, queryWrapper } from '../../../test/queryClient'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useTodosQuery } from './useTodosQuery'

vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn() } }))

it('loads the task list into the list cache key, passing an abort signal', async () => {
  vi.mocked(todosApi.list).mockResolvedValue([todoFixture])
  const client = createTestQueryClient()

  const { result } = renderHook(() => useTodosQuery(), {
    wrapper: queryWrapper(client),
  })

  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual([todoFixture])
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  expect(todosApi.list).toHaveBeenCalledWith(expect.any(AbortSignal))
})

it('exposes a loading failure', async () => {
  vi.mocked(todosApi.list).mockRejectedValue(new Error('Cannot connect.'))

  const { result } = renderHook(() => useTodosQuery(), {
    wrapper: queryWrapper(createTestQueryClient()),
  })

  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('Cannot connect.')
})
