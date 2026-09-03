'use client'

import type { Locale } from '@jomma/shared'
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { LOCALE_LABELS, LOCALES } from '@/lib/i18n/config'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

export function LocaleToggleItems() {
  const { locale, setLocale } = useI18n()
  return (
    <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      {LOCALES.map((option) => (
        <DropdownMenuRadioItem key={option} value={option}>
          <span lang={option}>{LOCALE_LABELS[option]}</span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

export function LocaleSegmented({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n()
  return (
    // A <fieldset> would carry form semantics this segmented control does not
    // have. role="group" with an aria-label is the right pattern for a
    // toolbar-style toggle.
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5',
        className,
      )}
      role="group"
      aria-label={t('locale.label')}
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option}
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          className={cn(
            'rounded-md px-2.5 py-1 text-small transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            locale === option
              ? 'bg-secondary text-secondary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {LOCALE_LABELS[option]}
        </button>
      ))}
    </div>
  )
}
