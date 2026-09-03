'use client'

import { ComputerIcon, Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'light', icon: Sun03Icon, labelKey: 'theme.light' },
  { value: 'dark', icon: Moon02Icon, labelKey: 'theme.dark' },
  { value: 'system', icon: ComputerIcon, labelKey: 'theme.system' },
] as const

/**
 * Three-state, and it lives in the user menu rather than the top bar — it is set
 * once, not adjusted. Rendered as menu items so it composes into that menu.
 */
export function ThemeToggleItems() {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const [mounted, setMounted] = useState(false)

  // `theme` is undefined until next-themes reads localStorage. Rendering the
  // radio state before that would tick the wrong row for a frame.
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <>
        {OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} disabled>
            <HugeiconsIcon icon={option.icon} strokeWidth={2} className="size-4" />
            {t(option.labelKey)}
          </DropdownMenuItem>
        ))}
      </>
    )
  }

  return (
    <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
      {OPTIONS.map((option) => (
        <DropdownMenuRadioItem key={option.value} value={option.value}>
          <HugeiconsIcon icon={option.icon} strokeWidth={2} className="size-4" />
          {t(option.labelKey)}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/**
 * Standalone segmented control. Used on /dev/tokens, where flipping modes
 * repeatedly is the whole point, and nowhere in the product chrome.
 */
export function ThemeSegmented({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5',
        className,
      )}
      // A <fieldset> would carry form semantics this segmented control does not
      // have. role="group" with an aria-label is the right pattern here.
      role="group"
      aria-label={t('theme.label')}
    >
      {OPTIONS.map((option) => {
        const active = mounted && (theme ?? 'system') === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-small transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <HugeiconsIcon icon={option.icon} strokeWidth={2} className="size-3.5" />
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
