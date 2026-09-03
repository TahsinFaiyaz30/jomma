import type { Metadata, Viewport } from 'next'
import { Hind_Siliguri, IBM_Plex_Mono, Instrument_Sans } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { I18nProvider } from '@/lib/i18n/provider'
import { getLocale } from '@/lib/i18n/server'
import { cn } from '@/lib/utils'
import './globals.css'

/*
 * Not Inter, not Geist. Instrument Sans carries the interface, IBM Plex Mono is
 * reserved for strings read character-by-character, Hind Siliguri covers Bengali.
 * See docs/design.md.
 */

const instrument = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

const hindSiliguri = Hind_Siliguri({
  subsets: ['bengali', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-hind-siliguri',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Jomma',
    template: '%s · Jomma',
  },
  description: 'Payment verification for Bangladeshi mobile financial services.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  // Tells the browser to paint the correct scrollbar and form-control chrome
  // before React hydrates, so nothing flashes white at 2am.
  colorScheme: 'dark light',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()

  return (
    <html
      lang={locale}
      // next-themes writes the class on <html> from its blocking inline script
      // before paint; the server cannot know which one, so the mismatch is
      // expected and suppressed rather than hydration-warned.
      suppressHydrationWarning
      className={cn(instrument.variable, plexMono.variable, hindSiliguri.variable)}
    >
      <body className="min-h-svh bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          <I18nProvider locale={locale}>
            {children}
            <Toaster position="bottom-right" />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
