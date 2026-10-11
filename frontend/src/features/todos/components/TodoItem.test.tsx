import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoItem } from './TodoItem'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

afterEach(() => vi.useRealTimers())

function renderItem(todo = todoFixture, busy = false) {
  const handlers = { onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() }
  render(<TodoItem todo={todo} busy={busy} {...handlers} />)
  return handlers
}

it('shows an active task and forwards edit requests', async () => {
  const user = userEvent.setup()
  const { onEdit, onToggle, onDelete } = renderItem()
  expect(screen.getByRole('heading', { name: todoFixture.title })).toBeVisible()
  expect(screen.getByText('To do')).toBeVisible()
  expect(screen.getByText('Medium')).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  await user.click(
    screen.getByRole('button', { name: `Edit: ${todoFixture.title}` }),
  )
  expect(onEdit).toHaveBeenCalledTimes(1)
  expect(onToggle).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('completes and deletes through labelled controls', async () => {
  const user = userEvent.setup()
  const { onToggle, onDelete } = renderItem()
  await user.click(
    screen.getByRole('checkbox', { name: `Complete: ${todoFixture.title}` }),
  )
  await user.click(
    screen.getByRole('button', { name: `Delete: ${todoFixture.title}` }),
  )
  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('shows a completed task with its description and an action to reopen it', () => {
  renderItem({
    ...todoFixture,
    completed: true,
    description: 'Slides and demo script',
  })
  expect(screen.getByText('Completed')).toBeVisible()
  expect(screen.getByText('Slides and demo script')).toBeVisible()
  expect(
    screen.getByRole('checkbox', {
      name: `Mark as active: ${todoFixture.title}`,
    }),
  ).toBeChecked()
})

it('marks an open task past its due date as overdue', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12, 0))
  renderItem({ ...todoFixture, due_date: '2026-10-15' })
  expect(screen.getByText(/15 Oct 2026/)).toHaveTextContent(
    '15 Oct 2026 · overdue',
  )
})

it('shows a future due date without the overdue marker', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 1, 12, 0))
  renderItem({ ...todoFixture, due_date: '2026-10-15' })
  expect(screen.getByText(/15 Oct 2026/)).not.toHaveTextContent('overdue')
})

it('disables every control while busy', () => {
  renderItem(todoFixture, true)
  expect(screen.getByRole('checkbox')).toBeDisabled()
  for (const button of screen.getAllByRole('button'))
    expect(button).toBeDisabled()
})
