'use client'

import type { Locale } from '@jomma/shared'
import { createContext, useCallback, useContext, useMemo, useTransition } from 'react'
import { LOCALE_COOKIE } from './config'
import * as fmt from './format'
import { type MessageKey, translate } from './messages'

interface I18nValue {
  locale: Locale
  t: (key: MessageKey) => string
  setLocale: (locale: Locale) => void
  isSwitching: boolean
  amount: (poisha: number, options?: { sign?: boolean; decimals?: boolean }) => string
  delta: (poisha: number) => string
  number: (value: number) => string
  percent: (fraction: number) => string
  clock: (value: Date | string) => string
  dateTime: (value: Date | string) => string
  elapsed: (from: Date | string, now?: Date) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const [isSwitching, startTransition] = useTransition()

  const setLocale = useCallback((next: Locale) => {
    // A year-long cookie, read by the root layout on the server so the very
    // first paint is already in the right language.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    startTransition(() => {
      window.location.reload()
    })
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      isSwitching,
      setLocale,
      t: (key) => translate(locale, key),
      amount: (poisha, options) => fmt.formatAmount(poisha, locale, options),
      delta: (poisha) => fmt.formatDelta(poisha, locale),
      number: (value) => fmt.formatNumber(value, locale),
      percent: (fraction) => fmt.formatPercent(fraction, locale),
      clock: (value) => fmt.formatClock(value, locale),
      dateTime: (value) => fmt.formatDateTime(value, locale),
      elapsed: (from, now) => fmt.formatElapsed(from, now, locale),
    }),
    [locale, isSwitching, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>')
  return context
}
