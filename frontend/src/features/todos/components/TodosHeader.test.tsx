import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { TodosHeader } from './TodosHeader'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))

it('shows the completed count and clears when there are completed tasks', async () => {
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

it.each([
  { disabled: false, completedCount: 0 },
  { disabled: true, completedCount: 2 },
])(
  'disables clearing when disabled=$disabled and completed=$completedCount',
  async ({ disabled, completedCount }) => {
    const user = userEvent.setup()
    const onClearCompleted = vi.fn()
    render(
      <TodosHeader
        disabled={disabled}
        onCreate={vi.fn()}
        completedCount={completedCount}
        onClearCompleted={onClearCompleted}
      />,
    )
    const button = screen.getByRole('button', {
      name: `Clear completed (${completedCount})`,
    })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onClearCompleted).not.toHaveBeenCalled()
  },
)

it('hides the clear button when no handler is given', () => {
  render(<TodosHeader disabled={false} onCreate={vi.fn()} />)
  expect(
    screen.queryByRole('button', { name: /Clear completed/ }),
  ).not.toBeInTheDocument()
})

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
