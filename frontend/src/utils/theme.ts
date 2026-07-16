export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'cp-data-system-theme'

export function getSavedTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
}

export function applyTheme(theme: ThemeMode, persist = true) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
  root.style.colorScheme = theme
  if (persist) window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  window.dispatchEvent(new CustomEvent<ThemeMode>('themechange', { detail: theme }))
}

