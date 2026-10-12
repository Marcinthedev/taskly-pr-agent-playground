import type { SelectHTMLAttributes } from 'react'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
  helperText?: string
  error?: string
  tooltip?: string
  state?: 'normal' | 'disabled' | 'locked'
  options: SelectOption[]
}
