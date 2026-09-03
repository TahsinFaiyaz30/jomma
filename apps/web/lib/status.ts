import type { AccountStatus, IntentStatus, PaymentRecordStatus } from '@jomma/shared'
import type { MessageKey } from '@/lib/i18n/messages'

/**
 * Maps every domain status onto one of five visual tones.
 *
 * The important line in docs/design.md: `offline` and `destructive` are the only
 * reds. An unmatched payment is normal and expected, so it is `pending`, not
 * `offline`. Colouring ordinary states red is how alarm fatigue starts, and
 * alarm fatigue in a payments tool is a real failure mode.
 */
export type StatusTone = 'matched' | 'pending' | 'ambiguous' | 'offline' | 'neutral'

export interface StatusMeta {
  tone: StatusTone
  labelKey: MessageKey
}

export const INTENT_STATUS_META: Record<IntentStatus, StatusMeta> = {
  open: { tone: 'pending', labelKey: 'status.open' },
  matched: { tone: 'matched', labelKey: 'status.matched' },
  // Short of the total. Not broken — the client decides what to do next.
  partial: { tone: 'ambiguous', labelKey: 'status.partial' },
  over: { tone: 'ambiguous', labelKey: 'status.over' },
  expired: { tone: 'neutral', labelKey: 'status.expired' },
  cancelled: { tone: 'neutral', labelKey: 'status.cancelled' },
}

export const PAYMENT_STATUS_META: Record<PaymentRecordStatus, StatusMeta> = {
  unmatched: { tone: 'pending', labelKey: 'status.unmatched' },
  matched: { tone: 'matched', labelKey: 'status.matched' },
  orphaned: { tone: 'ambiguous', labelKey: 'status.orphaned' },
  refunded: { tone: 'neutral', labelKey: 'status.refunded' },
}

export const ACCOUNT_STATUS_META: Record<AccountStatus, StatusMeta> = {
  active: { tone: 'matched', labelKey: 'status.active' },
  degraded: { tone: 'ambiguous', labelKey: 'status.degraded' },
  disabled: { tone: 'offline', labelKey: 'status.disabled' },
}

/** Tailwind pairs per tone. Solid fill, tinted surface, and the dot colour. */
export const TONE_CLASSES: Record<
  StatusTone,
  { dot: string; subtle: string; solid: string; text: string }
> = {
  matched: {
    dot: 'bg-matched',
    subtle: 'bg-matched-subtle text-matched-subtle-foreground',
    solid: 'bg-matched text-matched-foreground',
    text: 'text-matched-subtle-foreground',
  },
  pending: {
    dot: 'bg-pending',
    subtle: 'bg-pending-subtle text-pending-subtle-foreground',
    solid: 'bg-pending text-pending-foreground',
    text: 'text-pending-subtle-foreground',
  },
  ambiguous: {
    dot: 'bg-ambiguous',
    subtle: 'bg-ambiguous-subtle text-ambiguous-subtle-foreground',
    solid: 'bg-ambiguous text-ambiguous-foreground',
    text: 'text-ambiguous-subtle-foreground',
  },
  offline: {
    dot: 'bg-offline',
    subtle: 'bg-offline-subtle text-offline-subtle-foreground',
    solid: 'bg-offline text-offline-foreground',
    text: 'text-offline-subtle-foreground',
  },
  neutral: {
    dot: 'bg-muted-foreground/60',
    subtle: 'bg-muted text-muted-foreground',
    solid: 'bg-secondary text-secondary-foreground',
    text: 'text-muted-foreground',
  },
}
