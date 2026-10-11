import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import type { Todo } from '../types'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: ({ hasTodos }: { hasTodos: boolean }) => (
    <p>{hasTodos ? 'No matching tasks' : 'Empty task list'}</p>
  ),
}))
vi.mock('./TodoItem', () => ({
  TodoItem: (props: {
    todo: Todo
    busy: boolean
    onToggle: () => void
    onEdit: () => void
    onDelete: () => void
  }) => (
    <li>
      {props.todo.title}
      <button disabled={props.busy} onClick={props.onToggle}>
        toggle {props.todo.title}
      </button>
      <button onClick={props.onEdit}>edit {props.todo.title}</button>
      <button onClick={props.onDelete}>delete {props.todo.title}</button>
    </li>
  ),
}))

const props = {
  todos: [] as Todo[],
  hasTodos: false,
  loading: false,
  failed: false,
  busy: false,
  onCreate: vi.fn(),
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
}

it('shows loading feedback before showing an empty list', () => {
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})

it('explains that the list is unavailable when the first load failed', () => {
  render(<TodoList {...props} failed />)
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
})

it('keeps showing known tasks when a refetch failed', () => {
  render(<TodoList {...props} failed hasTodos todos={[todoFixture]} />)
  expect(screen.getByRole('listitem')).toHaveTextContent(todoFixture.title)
})

it('renders each task and forwards actions with the task', async () => {
  const user = userEvent.setup()
  const second = { ...todoFixture, id: 8, title: 'Ship it' }
  const onToggle = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  render(
    <TodoList
      {...props}
      hasTodos
      todos={[todoFixture, second]}
      onToggle={onToggle}
      onEdit={onEdit}
      onDelete={onDelete}
    />,
  )

  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'toggle Ship it' }))
  await user.click(screen.getByRole('button', { name: `edit ${todoFixture.title}` }))
  await user.click(screen.getByRole('button', { name: 'delete Ship it' }))
  expect(onToggle).toHaveBeenCalledWith(second)
  expect(onEdit).toHaveBeenCalledWith(todoFixture)
  expect(onDelete).toHaveBeenCalledWith(second)
})

it('shows the filtered-empty state when tasks exist but none match', () => {
  render(<TodoList {...props} hasTodos todos={[]} />)
  expect(screen.getByText('No matching tasks')).toBeVisible()
})
