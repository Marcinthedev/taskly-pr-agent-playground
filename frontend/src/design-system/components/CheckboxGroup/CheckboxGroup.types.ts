export interface CheckboxGroupProps {
  label: string
  tooltip?: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  helper?: string
  error?: string
  disabled?: boolean
}
