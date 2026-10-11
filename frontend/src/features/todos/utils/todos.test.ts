import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, isOverdue, selectTodos, validateTodo } from './todos'
import type { Todo, TodoInput } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('sorts by due date with undated tasks last, then by newest id', () => {
    const early = { ...base, id: 2, due_date: '2026-10-05' }
    const late = { ...base, id: 3, due_date: '2026-11-01' }
    const undatedOld = { ...base, id: 4 }
    const undatedNew = { ...base, id: 5 }
    expect(selectTodos([undatedOld, late, undatedNew, early], 'all', '', 'due')).toEqual([
      early,
      late,
      undatedNew,
      undatedOld,
    ])
  })

  it('sorts newest first by creation time, breaking ties by id', () => {
    const older = { ...base, id: 2, created_at: '2026-09-01T00:00:00Z' }
    const tieLow = { ...base, id: 3 }
    const tieHigh = { ...base, id: 4 }
    expect(selectTodos([older, tieLow, tieHigh], 'all', '', 'newest')).toEqual([
      tieHigh,
      tieLow,
      older,
    ])
  })

  it('keeps only completed tasks for the completed filter', () => {
    const done = { ...base, id: 2, completed: true }
    expect(selectTodos([base, done], 'completed', '', 'newest')).toEqual([done])
  })
})

describe('validateTodo', () => {
  const valid: TodoInput = {
    title: 'Plan',
    description: '',
    priority: 'low',
    due_date: '2026-10-15',
    completed: false,
  }

  it('accepts a valid task', () => {
    expect(validateTodo(valid)).toEqual({})
  })

  it.each([
    [{ title: '   ' }, { title: 'Enter a task title.' }],
    [{ title: 'x'.repeat(121) }, { title: 'The title must be at most 120 characters.' }],
    [{ description: 'x'.repeat(2001) }, { description: 'The description must be at most 2000 characters.' }],
    [{ due_date: '2026-02-30' }, { due_date: 'Enter a valid date.' }],
    [{ due_date: '15.10.2026' }, { due_date: 'Enter a valid date.' }],
  ])('reports %j as %j', (change, errors) => {
    expect(validateTodo({ ...valid, ...change })).toEqual(errors)
  })

  it('accepts exactly 120 title characters after trimming', () => {
    expect(validateTodo({ ...valid, title: ` ${'x'.repeat(120)} ` })).toEqual({})
  })
})

describe('isOverdue', () => {
  afterEach(() => vi.useRealTimers())

  it('flags open tasks whose due date is before today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 11, 9, 0))
    expect(isOverdue({ ...base, due_date: '2026-10-10' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-10-11' })).toBe(false)
    expect(isOverdue({ ...base, due_date: '2026-10-10', completed: true })).toBe(false)
    expect(isOverdue({ ...base, due_date: null })).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats a calendar date in British style', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})
