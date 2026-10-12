import type { HTMLAttributes } from 'react'

export type CardVariant = 'outline' | 'elevated'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
}
