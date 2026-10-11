import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('starts without a notice', () => {
  const { result } = renderHook(() => useNotice())
  expect(result.current.message).toBe('')
})

it('shows a notice for four seconds', () => {
  const { result } = renderHook(() => useNotice())

  act(() => result.current.notify('Task deleted.'))
  expect(result.current.message).toBe('Task deleted.')

  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Task deleted.')

  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})

it('restarts the timer when the same message is sent again', () => {
  const { result } = renderHook(() => useNotice())

  act(() => result.current.notify('Changes saved.'))
  act(() => vi.advanceTimersByTime(3000))
  act(() => result.current.notify('Changes saved.'))
  act(() => vi.advanceTimersByTime(3000))

  expect(result.current.message).toBe('Changes saved.')
})
