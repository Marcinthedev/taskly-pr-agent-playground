import { expect, it } from 'vitest'
import { todoKeys } from './queryKeys'

it('scopes the clear-completed mutation key under the todos namespace', () => {
  expect(todoKeys.clearCompleted).toEqual(['todos', 'clear-completed'])
})
