'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * Three modes, system default. `disableTransitionOnChange` stops every token in
 * the app animating at once when you flip — without it the switch reads as a
 * glitch rather than a change.
 *
 * The flash guard is the blocking inline script next-themes injects here; it
 * runs before first paint and sets the class on <html>.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="jomma-theme"
    >
      {children}
    </NextThemesProvider>
  )
}
