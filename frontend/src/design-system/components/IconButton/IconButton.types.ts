import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type IconButtonSize = 'small' | 'medium' | 'large'
export type IconButtonState = 'normal' | 'disabled' | 'locked'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'solid' | 'ghost'
  size?: IconButtonSize
  state?: IconButtonState
  lockedIcon?: ReactNode
}
