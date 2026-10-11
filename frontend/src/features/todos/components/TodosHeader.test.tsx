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

it('shows the completed count and fires the clear callback', async () => {
  const user = userEvent.setup()
  const onClearCompleted = vi.fn()
  render(
    <TodosHeader
      disabled={false}
      onCreate={vi.fn()}
      completedCount={3}
      onClearCompleted={onClearCompleted}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Clear completed (3)' }))

  expect(onClearCompleted).toHaveBeenCalledTimes(1)
})

it('disables clearing when no task is completed', async () => {
  const user = userEvent.setup()
  const onClearCompleted = vi.fn()
  render(
    <TodosHeader
      disabled={false}
      onCreate={vi.fn()}
      completedCount={0}
      onClearCompleted={onClearCompleted}
    />,
  )
  const button = screen.getByRole('button', { name: 'Clear completed (0)' })

  await user.click(button)

  expect(button).toBeDisabled()
  expect(onClearCompleted).not.toHaveBeenCalled()
})

it('disables clearing while the header is disabled', () => {
  render(
    <TodosHeader
      disabled
      onCreate={vi.fn()}
      completedCount={2}
      onClearCompleted={vi.fn()}
    />,
  )

  expect(screen.getByRole('button', { name: 'Clear completed (2)' })).toBeDisabled()
})

it('hides the clear button when no clear callback is given', () => {
  render(<TodosHeader disabled={false} onCreate={vi.fn()} completedCount={2} />)

  expect(
    screen.queryByRole('button', { name: /Clear completed/ }),
  ).not.toBeInTheDocument()
})
