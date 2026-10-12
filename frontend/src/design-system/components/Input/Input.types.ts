import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

type BaseProps = {
  label?: string
  hint?: string
  helperText?: string
  error?: string
  tooltip?: string
  state?: 'normal' | 'disabled' | 'locked'
  multiline?: boolean
  rows?: number
}

export type InputProps = BaseProps &
  InputHTMLAttributes<HTMLInputElement> &
  TextareaHTMLAttributes<HTMLTextAreaElement>
