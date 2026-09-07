'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * Three modes, system default. `disableTransitionOnChange` stops every token in
 * the app animating at once when you flip — without it the switch reads as a
 * glitch rather than a change.
 *
 * The flash guard is the blocking inline script next-themes injects here; it
 * runs before first paint and sets the class on <html>.
 *
 * That script is inline, so the Content-Security-Policy in `proxy.ts`
 * blocks it unless it carries the request's nonce — and a blocked flash guard
 * fails in the least visible way there is: everything works, and every cold
 * load of a dark-mode dashboard flashes white first. The nonce comes from the
 * root layout, which is the only place that can read the request headers.
 */
export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="jomma-theme"
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  )
}
