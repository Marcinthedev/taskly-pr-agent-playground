import styled from 'styled-components'
import type { CardVariant } from './Card.types'
import { cardVariantStyles } from './Card.variants'

interface BaseCardStyleProps {
  $variant: CardVariant
}

export const BaseCard = styled.div<BaseCardStyleProps>`
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.radii.lg};
  display: grid;
  gap: ${({ theme }) => theme.spacing.md};

  ${({ $variant }) => cardVariantStyles[$variant]}
`
