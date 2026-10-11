import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const active = {
  ...todoFixture,
  id: 1,
  title: 'Write report',
  priority: 'low' as const,
}
const done = {
  ...todoFixture,
  id: 2,
  title: 'Book flights',
  completed: true,
  priority: 'high' as const,
}

it('starts showing every task, newest first', () => {
  const { result } = renderHook(() => useTodoFilters([active, done]))

  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toEqual([done, active])
})

it('applies status, search and sort changes to the visible tasks', () => {
  const { result } = renderHook(() => useTodoFilters([active, done]))

  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([done])

  act(() => {
    result.current.setFilter('all')
    result.current.setSearch('REPORT')
  })
  expect(result.current.visible).toEqual([active])

  act(() => {
    result.current.setSearch('')
    result.current.setSort('priority')
  })
  expect(result.current.visible).toEqual([done, active])
})
