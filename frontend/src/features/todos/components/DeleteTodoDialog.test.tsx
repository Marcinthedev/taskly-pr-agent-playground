import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useDeleteTodoMutation } from '../hooks/useDeleteTodoMutation'
import { DeleteTodoDialog } from './DeleteTodoDialog'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('../hooks/useDeleteTodoMutation', () => ({
  useDeleteTodoMutation: vi.fn(),
}))

function mockMutation(state: { isPending?: boolean; error?: Error | null; mutateAsync?: ReturnType<typeof vi.fn> }) {
  const mutateAsync = state.mutateAsync ?? vi.fn().mockResolvedValue(undefined)
  vi.mocked(useDeleteTodoMutation).mockReturnValue({
    isPending: state.isPending ?? false,
    error: state.error ?? null,
    mutateAsync,
  } as unknown as ReturnType<typeof useDeleteTodoMutation>)
  return mutateAsync
}

function renderDialog(busy = false) {
  const onClose = vi.fn()
  const onDeleted = vi.fn()
  render(
    <DeleteTodoDialog todo={todoFixture} busy={busy} onClose={onClose} onDeleted={onDeleted} />,
  )
  return { onClose, onDeleted }
}

it('shows a deletion error and allows cancelling without deleting', async () => {
  const user = userEvent.setup()
  const mutateAsync = mockMutation({ error: new Error('Could not delete.') })
  const { onClose, onDeleted } = renderDialog()

  expect(screen.getByRole('dialog', { name: 'Delete task?' })).toBeVisible()
  expect(
    screen.getByText(`The task “${todoFixture.title}” will be permanently deleted.`),
  ).toBeVisible()
  expect(screen.getByTestId('alert')).toHaveTextContent('Could not delete.')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(mutateAsync).not.toHaveBeenCalled()
  expect(onDeleted).not.toHaveBeenCalled()
})

it('deletes the task and reports success', async () => {
  const user = userEvent.setup()
  const mutateAsync = mockMutation({})
  const { onDeleted } = renderDialog()

  await user.click(screen.getByRole('button', { name: 'Delete task' }))

  expect(mutateAsync).toHaveBeenCalledWith(todoFixture.id)
  expect(onDeleted).toHaveBeenCalledTimes(1)
})

it('stays open when the deletion fails', async () => {
  const user = userEvent.setup()
  mockMutation({ mutateAsync: vi.fn().mockRejectedValue(new Error('Task not found.')) })
  const { onDeleted, onClose } = renderDialog()

  await user.click(screen.getByRole('button', { name: 'Delete task' }))

  expect(onDeleted).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

it('locks the dialog while a deletion is pending', () => {
  const mutateAsync = mockMutation({ isPending: true })
  renderDialog()

  expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(mutateAsync).not.toHaveBeenCalled()
})

it('locks the dialog while another task mutation runs', () => {
  mockMutation({})
  renderDialog(true)
  expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
})
