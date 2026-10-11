import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TodosHeader } from './TodosHeader'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('invokes creation when enabled and blocks it when disabled', async () => {
  const user = userEvent.setup()
  const onCreate = vi.fn()
  const { rerender } = render(
    <TodosHeader disabled={false} onCreate={onCreate} />,
  )
  expect(screen.getByRole('heading', { name: 'Tasks' })).toBeVisible()
  expect(
    screen.getByText('Create, organize, and complete tasks.'),
  ).toBeVisible()
  const button = screen.getByRole('button', { name: 'New task' })
  await user.click(button)
  expect(onCreate).toHaveBeenCalledTimes(1)
  rerender(<TodosHeader disabled onCreate={onCreate} />)
  expect(button).toBeDisabled()
  await user.click(button)
  expect(onCreate).toHaveBeenCalledTimes(1)
})

it('hides the clear button when no handler is provided', () => {
  render(<TodosHeader disabled={false} onCreate={vi.fn()} />)
  expect(screen.queryByRole('button', { name: /Clear completed/ })).not.toBeInTheDocument()
})

it('shows the completed count and clears when enabled', async () => {
  const user = userEvent.setup()
  const onClear = vi.fn()
  render(
    <TodosHeader disabled={false} onCreate={vi.fn()} completedCount={2} onClearCompleted={onClear} />,
  )
  await user.click(screen.getByRole('button', { name: 'Clear completed (2)' }))
  expect(onClear).toHaveBeenCalledTimes(1)
})

it('disables clearing with no completed tasks or while disabled', () => {
  const { rerender } = render(
    <TodosHeader disabled={false} onCreate={vi.fn()} onClearCompleted={vi.fn()} />,
  )
  expect(screen.getByRole('button', { name: 'Clear completed (0)' })).toBeDisabled()
  rerender(
    <TodosHeader disabled onCreate={vi.fn()} completedCount={2} onClearCompleted={vi.fn()} />,
  )
  expect(screen.getByRole('button', { name: 'Clear completed (2)' })).toBeDisabled()
})
