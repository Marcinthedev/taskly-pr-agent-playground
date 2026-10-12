import type { ReactNode } from 'react'

export interface DrawerProps {
  title: string
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  busy?: boolean
}
