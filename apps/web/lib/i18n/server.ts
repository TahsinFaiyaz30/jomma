import 'server-only'

import type { Locale } from '@jomma/shared'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from './config'
import { type MessageKey, translate } from './messages'

/** Resolves the request locale from the cookie the client-side switcher sets. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies()
  const value = store.get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/** Server-component translator. `const t = await getTranslator()`. */
export async function getTranslator(): Promise<(key: MessageKey) => string> {
  const locale = await getLocale()
  return (key) => translate(locale, key)
}
