import { BaseCard } from './Card.styles'
import type { CardProps } from './Card.types'

export function Card({ variant = 'outline', ...props }: CardProps) {
  return <BaseCard {...props} $variant={variant} />
}
