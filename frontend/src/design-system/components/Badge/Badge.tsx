import { BaseBadge } from './Badge.styles'
import type { BadgeProps } from './Badge.types'

export function Badge({ variant = 'neutral', ...props }: BadgeProps) {
  return <BaseBadge {...props} $variant={variant} />
}
