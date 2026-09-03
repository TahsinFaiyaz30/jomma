import type { Locale } from '@jomma/shared'

export const LOCALES = ['en', 'bn'] as const
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'jomma_locale'

/** Everything in Jomma is Bangladesh-local. Never render a payment in UTC. */
export const DISPLAY_TIMEZONE = 'Asia/Dhaka'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  bn: 'বাংলা',
}

/**
 * CLDR tags. `bn-BD` gives Bengali numerals and lakh/crore grouping;
 * `en-BD` gives Latin numerals and thousands grouping.
 */
export const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-BD',
  bn: 'bn-BD',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
