'use client'

import type { MessageKey } from '@/lib/i18n/messages'
import { useI18n } from '@/lib/i18n/provider'
import { type StatusTone, TONE_CLASSES } from '@/lib/status'
import { cn } from '@/lib/utils'

/**
 * Status is a filled dot *plus* a label, never colour alone. Colour alone fails
 * for colour-blind users and fails in a screenshot pasted into a support chat.
 */

export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: StatusTone
  /** One pulse then hold, for a device that has just gone offline. Never a loop. */
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        TONE_CLASSES[tone].dot,
        pulse && 'pulse-once',
        className,
      )}
    />
  )
}

export function StatusLabel({
  tone,
  labelKey,
  className,
}: {
  tone: StatusTone
  labelKey: MessageKey
  className?: string
}) {
  const { t } = useI18n()
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <StatusDot tone={tone} />
      <span className={cn('text-small', TONE_CLASSES[tone].text)}>{t(labelKey)}</span>
    </span>
  )
}

export function StatusBadge({
  tone,
  labelKey,
  className,
}: {
  tone: StatusTone
  labelKey: MessageKey
  className?: string
}) {
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium',
        TONE_CLASSES[tone].subtle,
        className,
      )}
    >
      <StatusDot tone={tone} />
      {t(labelKey)}
    </span>
  )
}
