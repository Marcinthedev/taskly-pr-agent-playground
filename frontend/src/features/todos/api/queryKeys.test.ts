import { expect, it } from 'vitest'
import { todoKeys } from './queryKeys'

it('exposes a distinct clear-completed mutation key', () => {
  expect(todoKeys.clearCompleted).toEqual(['todos', 'clear-completed'])
  expect(todoKeys.clearCompleted).not.toEqual(todoKeys.delete)
})
