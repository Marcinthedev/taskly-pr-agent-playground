import { render, screen } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'styled-components'
import { expect, it } from 'vitest'
import { theme } from '../design-system'
import { createTestQueryClient } from '../test/queryClient'
import { AppProviders } from './AppProviders'

function Probe({ onRender }: { onRender: (value: unknown) => void }) {
  onRender({ client: useQueryClient(), theme: useTheme() })
  return <p>child content</p>
}

it('renders children inside the query client and theme providers', () => {
  const client = createTestQueryClient()
  let seen: { client?: unknown; theme?: unknown } = {}

  render(
    <AppProviders client={client}>
      <Probe onRender={(value) => (seen = value as typeof seen)} />
    </AppProviders>,
  )

  expect(screen.getByText('child content')).toBeVisible()
  expect(seen.client).toBe(client)
  expect(seen.theme).toBe(theme)
})
