import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { todoFixture } from '../../test/todoFixture'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useClearCompletedMutation } from './hooks/useClearCompletedMutation'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'
import type { Todo } from './types'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: ({
    onCreate,
    completedCount,
    onClearCompleted,
  }: {
    onCreate: () => void
    completedCount: number
    onClearCompleted: () => void
  }) => (
    <>
      <button onClick={onCreate}>New task</button>
      <button onClick={onClearCompleted}>
        Clear completed ({completedCount})
      </button>
    </>
  ),
}))
vi.mock('./hooks/useClearCompletedMutation', () => ({
  useClearCompletedMutation: vi.fn(),
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: (props: {
    todos: Todo[]
    onToggle: (todo: Todo) => void
    onDelete: (todo: Todo) => void
    onEdit: (todo: Todo) => void
  }) => (
    <ul>
      {props.todos.map((todo) => (
        <li key={todo.id}>
          <button onClick={() => props.onToggle(todo)}>
            toggle {todo.title}
          </button>
          <button onClick={() => props.onEdit(todo)}>edit {todo.title}</button>
          <button onClick={() => props.onDelete(todo)}>
            delete {todo.title}
          </button>
        </li>
      ))}
    </ul>
  ),
}))
vi.mock('./components/TodoEditor', () => ({
  TodoEditor: (props: {
    todo: Todo | 'new'
    onSaved: (notice: string) => void
    onClose: () => void
  }) => (
    <div
      role="dialog"
      aria-label={
        props.todo === 'new' ? 'New task' : `Edit ${props.todo.title}`
      }
    >
      <button onClick={() => props.onSaved('New task added.')}>save</button>
      <button onClick={props.onClose}>close editor</button>
    </div>
  ),
}))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: (props: {
    todo: Todo
    onDeleted: () => void
    onClose: () => void
  }) => (
    <div role="dialog" aria-label={`Delete ${props.todo.title}`}>
      <button onClick={props.onDeleted}>confirm delete</button>
      <button onClick={props.onClose}>keep task</button>
    </div>
  ),
}))
vi.mock('../../components/SuccessNotice', () => ({
  SuccessNotice: ({ message }: { message: string }) => (
    <p role="status">{message}</p>
  ),
}))

const notify = vi.fn()
const mutateAsync = vi.fn()
const clearAsync = vi.fn()

function setup({
  todos = [todoFixture],
  busy = false,
  queryError = null as Error | null,
  mutationError = null as Error | null,
  clearError = null as Error | null,
} = {}) {
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  const clearReset = vi.fn()
  vi.mocked(useClearCompletedMutation).mockReturnValue({
    error: clearError,
    reset: clearReset,
    mutateAsync: clearAsync,
  } as unknown as ReturnType<typeof useClearCompletedMutation>)
  vi.mocked(useTodosQuery).mockReturnValue({
    data: todos,
    isPending: false,
    isFetching: false,
    isError: Boolean(queryError),
    error: queryError,
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: mutationError,
    reset,
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: todos,
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  return { refetch, reset, clearReset, user: userEvent.setup() }
}

beforeEach(() => {
  notify.mockReset()
  mutateAsync.mockReset()
  clearAsync.mockReset()
})

const done = { ...todoFixture, completed: true }

it.each([
  { deleted: 1, message: 'Cleared 1 completed task.' },
  { deleted: 2, message: 'Cleared 2 completed tasks.' },
])('announces "$message" after clearing', async ({ deleted, message }) => {
  clearAsync.mockResolvedValue({ deleted })
  const { user } = setup({ todos: [done, { ...done, id: 2 }] })

  await user.click(screen.getByRole('button', { name: 'Clear completed (2)' }))

  expect(clearAsync).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith(message)
})

it('does not clear when no task is completed', async () => {
  const { user } = setup()

  await user.click(screen.getByRole('button', { name: 'Clear completed (0)' }))

  expect(clearAsync).not.toHaveBeenCalled()
})

it('does not clear while another mutation is running', async () => {
  const { user } = setup({ todos: [done], busy: true })

  await user.click(screen.getByRole('button', { name: 'Clear completed (1)' }))

  expect(clearAsync).not.toHaveBeenCalled()
})

it('stays quiet when clearing fails', async () => {
  clearAsync.mockRejectedValue(new Error('The server is unavailable.'))
  const { user } = setup({ todos: [done] })

  await user.click(screen.getByRole('button', { name: 'Clear completed (1)' }))

  expect(notify).not.toHaveBeenCalled()
})

it('shows a failed clear in the page alert and resets it on retry', async () => {
  const { user, clearReset } = setup({
    todos: [done],
    clearError: new Error('Could not clear tasks.'),
  })
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'Could not clear tasks.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(clearReset).toHaveBeenCalledTimes(1)
})

it('displays a query failure and resets mutation errors before retrying', async () => {
  const { user, refetch, reset } = setup({
    todos: [],
    queryError: new Error('The server is unavailable.'),
  })
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})

it('shows a failed toggle in the page alert', () => {
  setup({ mutationError: new Error('Task not found.') })
  expect(screen.getByTestId('alert')).toHaveTextContent('Task not found.')
})

it('completes an active task and celebrates', async () => {
  mutateAsync.mockResolvedValue({ ...todoFixture, completed: true })
  const { user } = setup()

  await user.click(
    screen.getByRole('button', { name: `toggle ${todoFixture.title}` }),
  )

  expect(mutateAsync).toHaveBeenCalledWith({
    id: todoFixture.id,
    input: { completed: true },
  })
  expect(notify).toHaveBeenCalledWith('Another task complete. Well done!')
})

it('reopens a completed task', async () => {
  const done = { ...todoFixture, completed: true }
  mutateAsync.mockResolvedValue({ ...done, completed: false })
  const { user } = setup({ todos: [done] })

  await user.click(screen.getByRole('button', { name: `toggle ${done.title}` }))

  expect(mutateAsync).toHaveBeenCalledWith({
    id: done.id,
    input: { completed: false },
  })
  expect(notify).toHaveBeenCalledWith('Task marked as active.')
})

it('stays quiet when the toggle fails', async () => {
  mutateAsync.mockRejectedValue(new Error('Task not found.'))
  const { user } = setup()

  await user.click(
    screen.getByRole('button', { name: `toggle ${todoFixture.title}` }),
  )

  expect(notify).not.toHaveBeenCalled()
})

it('ignores toggles while another mutation is running', async () => {
  const { user } = setup({ busy: true })

  await user.click(
    screen.getByRole('button', { name: `toggle ${todoFixture.title}` }),
  )

  expect(mutateAsync).not.toHaveBeenCalled()
})

it('opens the editor for a new task and closes it after saving', async () => {
  const { user } = setup()

  await user.click(screen.getByRole('button', { name: 'New task' }))
  expect(screen.getByRole('dialog', { name: 'New task' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'save' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('New task added.')
})

it('opens the editor for an existing task and closes it on cancel', async () => {
  const { user } = setup()

  await user.click(
    screen.getByRole('button', { name: `edit ${todoFixture.title}` }),
  )
  expect(
    screen.getByRole('dialog', { name: `Edit ${todoFixture.title}` }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'close editor' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
})

it('confirms a deletion and announces it', async () => {
  const { user } = setup()

  await user.click(
    screen.getByRole('button', { name: `delete ${todoFixture.title}` }),
  )
  expect(
    screen.getByRole('dialog', { name: `Delete ${todoFixture.title}` }),
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'confirm delete' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).toHaveBeenCalledWith('Task deleted.')
})

it('keeps the task when the deletion is cancelled', async () => {
  const { user } = setup()

  await user.click(
    screen.getByRole('button', { name: `delete ${todoFixture.title}` }),
  )
  await user.click(screen.getByRole('button', { name: 'keep task' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
})
