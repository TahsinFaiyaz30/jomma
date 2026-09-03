import type { Locale } from '@jomma/shared'
import { DISPLAY_TIMEZONE, INTL_LOCALE } from './config'

/**
 * Formatting. Every amount in Jomma is an integer number of poisha; nothing in
 * the codebase holds a float taka value, so rounding drift is impossible.
 */

export const POISHA_PER_TAKA = 100
export const TAKA_SIGN = '৳'

const numberFormatters = new Map<string, Intl.NumberFormat>()

function numberFormatter(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options)}`
  let formatter = numberFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], options)
    numberFormatters.set(key, formatter)
  }
  return formatter
}

/**
 * `120000` -> `৳1,200.00` (en) / `৳১,২০০.০০` (bn).
 *
 * The sign leads in both locales. CLDR puts it after the number for bn-BD, but
 * amounts live in a right-aligned tabular column and a trailing sign breaks the
 * decimal alignment that column exists for.
 */
export function formatAmount(
  poisha: number,
  locale: Locale = 'en',
  options: { sign?: boolean; decimals?: boolean } = {},
): string {
  const { sign = true, decimals = true } = options
  const taka = poisha / POISHA_PER_TAKA
  const body = numberFormatter(locale, {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(taka)
  return sign ? `${TAKA_SIGN}${body}` : body
}

/** Signed delta, for shortfall and excess. `-৳200.00` / `+৳300.00`. */
export function formatDelta(poisha: number, locale: Locale = 'en'): string {
  const prefix = poisha > 0 ? '+' : poisha < 0 ? '−' : ''
  return `${prefix}${formatAmount(Math.abs(poisha), locale)}`
}

export function formatNumber(value: number, locale: Locale = 'en'): string {
  return numberFormatter(locale, {}).format(value)
}

export function formatPercent(fraction: number, locale: Locale = 'en'): string {
  return numberFormatter(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(fraction)
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`
  let formatter = dateFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: DISPLAY_TIMEZONE,
      ...options,
    })
    dateFormatters.set(key, formatter)
  }
  return formatter
}

/** `14:35:12` — the feed's leading column. 24-hour, always. */
export function formatClock(value: Date | string, locale: Locale = 'en'): string {
  return dateFormatter(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(toDate(value))
}

export function formatDateTime(value: Date | string, locale: Locale = 'en'): string {
  return dateFormatter(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(toDate(value))
}

/**
 * Compact elapsed time for queue age and heartbeat gaps: `4s`, `12m`, `3h 20m`.
 * Deliberately not `Intl.RelativeTimeFormat` — "3 hours ago" is longer and
 * scans worse in a dense column than `3h`.
 */
export function formatElapsed(
  from: Date | string,
  now: Date = new Date(),
  locale: Locale = 'en',
): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - toDate(from).getTime()) / 1000))
  const unit = (n: number, en: string, bn: string) =>
    `${formatNumber(n, locale)}${locale === 'bn' ? bn : en}`

  if (seconds < 60) return unit(seconds, 's', 'সে')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return unit(minutes, 'm', 'মি')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest ? `${unit(hours, 'h', 'ঘ')} ${unit(rest, 'm', 'মি')}` : unit(hours, 'h', 'ঘ')
  }
  const days = Math.floor(hours / 24)
  return unit(days, 'd', 'দি')
}

/**
 * `8801712345678` -> `01712 345 678`. Never truncate in the dashboard — an
 * operator needs the whole number to call a buyer back.
 */
export function formatMsisdn(msisdn: string | null | undefined): string {
  if (!msisdn) return '—'
  const digits = msisdn.replace(/\D/g, '')
  const local = digits.startsWith('880') ? `0${digits.slice(3)}` : digits
  if (local.length !== 11) return local || '—'
  return `${local.slice(0, 5)} ${local.slice(5, 8)} ${local.slice(8)}`
}

/** Last four digits, for the sidebar footer where space is tight. */
export function maskMsisdn(msisdn: string | null | undefined): string {
  if (!msisdn) return '—'
  const digits = msisdn.replace(/\D/g, '')
  return `…${digits.slice(-4)}`
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}
