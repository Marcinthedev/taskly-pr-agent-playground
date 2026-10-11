import { act, renderHook, waitFor } from '@testing-library/react'
import { useMutation } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { createTestQueryClient, queryWrapper } from '../../../test/queryClient'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

it('is busy exactly while a task mutation is running', async () => {
  let finish!: () => void
  const { result } = renderHook(
    () => ({
      busy: useTodosBusy(),
      deletion: useMutation({
        mutationKey: todoKeys.delete,
        mutationFn: () => new Promise<void>((resolve) => (finish = resolve)),
      }),
    }),
    { wrapper: queryWrapper(createTestQueryClient()) },
  )
  expect(result.current.busy).toBe(false)

  act(() => result.current.deletion.mutate())
  await waitFor(() => expect(result.current.busy).toBe(true))

  act(() => finish())
  await waitFor(() => expect(result.current.busy).toBe(false))
})

it('ignores mutations outside the tasks key', async () => {
  const { result } = renderHook(
    () => ({
      busy: useTodosBusy(),
      other: useMutation({
        mutationKey: ['settings'],
        mutationFn: () => new Promise<void>(() => undefined),
      }),
    }),
    { wrapper: queryWrapper(createTestQueryClient()) },
  )

  act(() => result.current.other.mutate())
  await waitFor(() => expect(result.current.other.isPending).toBe(true))
  expect(result.current.busy).toBe(false)
})
