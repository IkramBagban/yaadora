import { createContext } from 'react'
import type { ThemeMode } from './types'

export interface ThemeContextValue {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  cycleMode: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)
