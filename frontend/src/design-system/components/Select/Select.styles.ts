import styled from 'styled-components'

export const Field = styled.div`
  display: grid;
  gap: ${({ theme }) => theme.spacing.xs};
`

export const ControlShell = styled.div`
  position: relative;
`

export const Label = styled.label`
  font-size: 0.9rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.inkStrong};
`

export const LabelRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
`

export const TooltipIcon = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surfaceAlt};
  color: ${({ theme }) => theme.colors.inkMuted};
  font-size: 0.75rem;
  font-weight: 700;
  cursor: help;

  &::after {
    content: attr(data-tooltip);
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translateX(-50%);
    min-width: 180px;
    max-width: 280px;
    padding: 8px 10px;
    border-radius: 10px;
    background: ${({ theme }) => theme.colors.inkStrong};
    color: ${({ theme }) => theme.colors.surface};
    font-size: 0.78rem;
    line-height: 1.35;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.16s ease;
    z-index: 10;
  }

  &:hover::after,
  &:focus-visible::after {
    opacity: 1;
  }
`

export const LockIcon = styled.span`
  position: absolute;
  right: 34px;
  top: 50%;
  transform: translateY(-50%);
  color: #7b4fa3;
  font-size: 0.95rem;
  pointer-events: none;
`

interface SelectStyleProps {
  $hasError: boolean
  $isLocked: boolean
}

export const Control = styled.select<SelectStyleProps>`
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid
    ${({ theme, $hasError }) =>
      $hasError ? theme.colors.warning : theme.colors.border};
  font-size: 0.95rem;
  background: ${({ $isLocked }) => ($isLocked ? '#f4effb' : '#fff')};
  color: inherit;
  cursor: ${({ $isLocked }) => ($isLocked ? 'not-allowed' : 'default')};
  padding-right: ${({ $isLocked }) => ($isLocked ? '62px' : '36px')};
  transition:
    border 0.2s ease,
    box-shadow 0.2s ease;

  ${({ $isLocked }) =>
    $isLocked
      ? `
    border-color: #b79ad4;
    color: #4f356f;
  `
      : ''}

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
    box-shadow: 0 0 0 3px rgba(31, 122, 140, 0.12);
  }

  &:disabled {
    background: #f1f2f3;
  }
`

export const Helper = styled.span<{ $hasError: boolean }>`
  font-size: 0.85rem;
  color: ${({ theme, $hasError }) =>
    $hasError ? theme.colors.warning : theme.colors.inkMuted};
`
