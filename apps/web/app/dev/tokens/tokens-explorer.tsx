'use client'

import { Alert02Icon, Copy01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState } from 'react'
import { LocaleSegmented } from '@/components/locale-toggle'
import { StatusBadge, StatusDot, StatusLabel } from '@/components/status'
import { ThemeSegmented } from '@/components/theme-toggle'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/lib/i18n/provider'
import type { StatusTone } from '@/lib/status'
import {
  ACCOUNT_STATUS_META,
  INTENT_STATUS_META,
  PAYMENT_STATUS_META,
  TONE_CLASSES,
} from '@/lib/status'
import { cn } from '@/lib/utils'

const BASE_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
] as const

const SIDEBAR_TOKENS = [
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
] as const

const CHART_TOKENS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const

const STATUS_TONES: StatusTone[] = ['matched', 'pending', 'ambiguous', 'offline', 'neutral']

const TYPE_SCALE = [
  {
    name: 'display',
    className: 'text-display',
    spec: '24px / 1.2 / -0.02em',
    use: 'Page titles only',
  },
  {
    name: 'title',
    className: 'text-title',
    spec: '18px / 1.3 / -0.01em',
    use: 'Section headings',
  },
  {
    name: 'body',
    className: 'text-body',
    spec: '14px / 1.5 / 0',
    use: 'Default',
  },
  {
    name: 'small',
    className: 'text-small',
    spec: '13px / 1.4 / 0',
    use: 'Table cells, secondary',
  },
  {
    name: 'micro',
    className: 'text-micro',
    spec: '11px / 1.3 / 0.01em',
    use: 'Timestamps, badges',
  },
] as const

export function TokensExplorer() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <Header />
      <Tabs defaultValue="color" className="mt-8">
        <TabsList>
          <TabsTrigger value="color">Colour</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="type">Type</TabsTrigger>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="density">Density</TabsTrigger>
        </TabsList>

        <TabsContent value="color" className="mt-6 space-y-10">
          <Swatches title="Base" tokens={BASE_TOKENS} />
          <Swatches title="Sidebar" tokens={SIDEBAR_TOKENS} />
          <Swatches title="Chart" tokens={CHART_TOKENS} />
        </TabsContent>

        <TabsContent value="status" className="mt-6 space-y-10">
          <StatusSection />
        </TabsContent>

        <TabsContent value="type" className="mt-6 space-y-10">
          <TypeSection />
        </TabsContent>

        <TabsContent value="components" className="mt-6 space-y-10">
          <ComponentSection />
        </TabsContent>

        <TabsContent value="density" className="mt-6 space-y-10">
          <DensitySection />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Header() {
  const [resolved, setResolved] = useState<string>('—')

  useEffect(() => {
    const read = () =>
      setResolved(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  return (
    <header className="space-y-4">
      <div>
        <h1 className="text-display font-medium">Design tokens</h1>
        <p className="mt-1 max-w-2xl text-body text-muted-foreground">
          Every token and component state, in all three theme modes and both locales. Check the
          status colours against their subtle backgrounds in each mode before building screens on
          top of them.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ThemeSegmented />
        <LocaleSegmented />
        <span className="text-small text-muted-foreground">
          Resolved: <span className="figure">{resolved}</span>
        </span>
      </div>
      <Separator />
    </header>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-title font-medium">{title}</h2>
        {hint ? <p className="mt-0.5 text-small text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Swatches({ title, tokens }: { title: string; tokens: readonly string[] }) {
  return (
    <Section title={title}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tokens.map((token) => (
          <Swatch key={token} token={token} />
        ))}
      </div>
    </Section>
  )
}

function Swatch({ token }: { token: string }) {
  const [value, setValue] = useState('')

  useEffect(() => {
    const read = () =>
      setValue(
        getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim() || '—',
      )
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [token])

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div
        className="h-12 w-full border-border border-b"
        style={{ background: `var(--${token})` }}
      />
      <div className="space-y-0.5 bg-card p-2">
        <div className="figure text-micro text-card-foreground">--{token}</div>
        <div className="figure truncate text-micro text-muted-foreground" title={value}>
          {value}
        </div>
      </div>
    </div>
  )
}

function StatusSection() {
  const { t } = useI18n()

  return (
    <>
      <Section
        title="Status tones"
        hint="Four roles per tone. `-foreground` is text on the solid fill; `-subtle-foreground` is text on the tinted surface. Pairing subtle with foreground is unreadable — that pairing is a documentation bug, not a token to use."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {STATUS_TONES.map((tone) => (
            <div key={tone} className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="figure text-small">{tone}</span>
                <StatusDot tone={tone} />
              </div>
              <div className={cn('rounded-md px-3 py-2 text-small', TONE_CLASSES[tone].solid)}>
                Solid fill — on-fill text
              </div>
              <div className={cn('rounded-md px-3 py-2 text-small', TONE_CLASSES[tone].subtle)}>
                Subtle surface — on-subtle text
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StatusBadge tone={tone} labelKey="status.matched" />
                <StatusLabel tone={tone} labelKey="status.pending" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Domain mapping" hint="How each stored status resolves to a tone.">
        <div className="grid gap-6 md:grid-cols-3">
          <MappingTable title="Intent" meta={INTENT_STATUS_META} />
          <MappingTable title="Payment" meta={PAYMENT_STATUS_META} />
          <MappingTable title="Account" meta={ACCOUNT_STATUS_META} />
        </div>
      </Section>

      <Section
        title="Red discipline"
        hint="offline and destructive are the only reds. Unmatched is normal and must never be red."
      >
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <StatusLabel tone="pending" labelKey="status.unmatched" />
          <span className="text-small text-muted-foreground">
            — money arrived, nothing claims it yet. Expected. Amber, not red.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <StatusLabel tone="offline" labelKey="status.offline" />
          <span className="text-small text-muted-foreground">
            — the device is down. {t('account.balanceDrift')} sits here too.
          </span>
        </div>
      </Section>
    </>
  )
}

function MappingTable({
  title,
  meta,
}: {
  title: string
  meta: Record<
    string,
    {
      tone: StatusTone
      labelKey: Parameters<typeof StatusLabel>[0]['labelKey']
    }
  >
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-small font-medium text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border/50 rounded-lg border border-border">
        {Object.entries(meta).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between px-3 py-2">
            <span className="figure text-micro text-muted-foreground">{key}</span>
            <StatusLabel tone={value.tone} labelKey={value.labelKey} />
          </div>
        ))}
      </div>
    </div>
  )
}

function TypeSection() {
  const { amount, clock, locale } = useI18n()
  const now = new Date()

  return (
    <>
      <Section title="Scale" hint="Sentence case everywhere. No ALL-CAPS labels.">
        <div className="divide-y divide-border/50 rounded-lg border border-border">
          {TYPE_SCALE.map((step) => (
            <div key={step.name} className="flex items-baseline gap-4 px-4 py-3">
              <span className="figure w-16 shrink-0 text-micro text-muted-foreground">
                {step.name}
              </span>
              <span className={cn(step.className, 'flex-1')}>
                Payment received from 01712 345 678
              </span>
              <span className="figure hidden w-40 shrink-0 text-right text-micro text-muted-foreground sm:block">
                {step.spec}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Figures"
        hint="Amounts stay in the interface sans with tabular figures. Monospace is reserved for strings read character-by-character."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 rounded-lg border border-border bg-card p-4">
            <div className="text-micro text-muted-foreground">Amounts — sans, tabular-nums</div>
            <div className="space-y-0.5 text-right">
              {[120000, 85000, 34000, 1500000, 999].map((poisha) => (
                <div key={poisha} className="amount text-body">
                  {amount(poisha)}
                </div>
              ))}
            </div>
            <p className="pt-1 text-micro text-muted-foreground">
              Decimal points must line up. Locale: <span className="figure">{locale}</span>
              {locale === 'bn' ? ' — Bengali numerals, lakh grouping' : ' — Latin numerals'}
            </p>
          </div>

          <div className="space-y-1 rounded-lg border border-border bg-card p-4">
            <div className="text-micro text-muted-foreground">Identifiers — IBM Plex Mono</div>
            <div className="space-y-0.5">
              {['BK7X2M9QP1', 'K7M2', '01712 345 678', 'jm_live_9f2c…', 'req_01J8XR4M9K'].map(
                (value) => (
                  <div key={value} className="figure text-body">
                    {value}
                  </div>
                ),
              )}
            </div>
            <p className="pt-1 text-micro text-muted-foreground">
              Character-by-character disambiguation is the point here.
            </p>
          </div>
        </div>
      </Section>

      <Section
        title="Bengali"
        hint="Hind Siliguri. Latin glyphs still come from Instrument Sans in the same stack."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4" lang="bn">
            <div className="text-title">জমা — পেমেন্ট যাচাই</div>
            <div className="mt-1 text-body text-muted-foreground">
              ০১৭১২ ৩৪৫ ৬৭৮ থেকে ৳১,২০০.০০ এসেছে। রেফারেন্স <span className="figure">K7M2</span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4" lang="en">
            <div className="text-title">Jomma — payment verification</div>
            <div className="mt-1 text-body text-muted-foreground">
              ৳1,200.00 received from 01712 345 678. Reference <span className="figure">K7M2</span>
            </div>
          </div>
        </div>
        <p className="text-micro text-muted-foreground">
          Clock renders as <span className="figure">{clock(now)}</span> in this locale.
        </p>
      </Section>
    </>
  )
}

function ComponentSection() {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map(
            (variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ),
          )}
          <Button disabled>disabled</Button>
          <Button size="sm">small</Button>
          <Button size="icon" aria-label="Search">
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="size-4" />
          </Button>
          <Button>
            <Spinner /> loading
          </Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          {(['default', 'secondary', 'outline', 'ghost', 'destructive'] as const).map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
          <Badge className="bg-pending-subtle text-pending-subtle-foreground">3</Badge>
          <Badge className="bg-ambiguous-subtle text-ambiguous-subtle-foreground">2</Badge>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid max-w-lg gap-3">
          <Input placeholder="Search TrxID, reference, or number" />
          <Input placeholder="Disabled" disabled />
          <Input aria-invalid placeholder="Invalid" />
          <div className="flex items-center gap-2">
            <Switch id="tokens-switch" />
            <label htmlFor="tokens-switch" className="text-small">
              Messages bridge (best-effort)
            </label>
          </div>
        </div>
      </Section>

      <Section
        title="Keyboard hints"
        hint="Shortcuts shown with kbd, so they're discoverable rather than folklore."
      >
        <div className="flex flex-wrap items-center gap-4 text-small">
          <span className="inline-flex items-center gap-2">
            <KbdGroup>
              <Kbd>j</Kbd>
              <Kbd>k</Kbd>
            </KbdGroup>
            move
          </span>
          <span className="inline-flex items-center gap-2">
            <Kbd>enter</Kbd> open
          </span>
          <span className="inline-flex items-center gap-2">
            <Kbd>a</Kbd> approve
          </span>
          <span className="inline-flex items-center gap-2">
            <Kbd>r</Kbd> reject
          </span>
          <span className="inline-flex items-center gap-2">
            <Kbd>/</Kbd> search
          </span>
          <span className="inline-flex items-center gap-2">
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>k</Kbd>
            </KbdGroup>
            palette
          </span>
        </div>
      </Section>

      <Section title="Loading and empty">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-border p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex h-row items-center gap-3">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border p-8 text-center">
            <HugeiconsIcon
              icon={Alert02Icon}
              strokeWidth={2}
              className="size-5 text-muted-foreground"
            />
            <div className="text-body">No payments yet</div>
            <div className="max-w-xs text-small text-muted-foreground">
              Incoming payments appear here the moment a device captures them.
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Destructive confirmation"
        hint="Red here is earned — reversing a match is irreversible."
      >
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          Reverse match
        </Button>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reverse this match?</AlertDialogTitle>
              <AlertDialogDescription>
                Jomma previously told the client this money arrived. Reversing sends a
                payment.reversed webhook and the client must be able to un-fulfil the order.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Reverse</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>
    </>
  )
}

function DensitySection() {
  const { amount, clock } = useI18n()
  const base = new Date('2026-09-03T14:35:12Z')

  const rows = [
    {
      amount: 120000,
      ref: 'K7M2',
      trx: 'BK7X2M9QP1',
      tone: 'matched' as const,
      label: 'status.matched' as const,
    },
    {
      amount: 85000,
      ref: 'P2W9',
      trx: 'BK5R1L8ZQ2',
      tone: 'matched' as const,
      label: 'status.matched' as const,
    },
    {
      amount: 120000,
      ref: '—',
      trx: 'BK9T3N4XM7',
      tone: 'ambiguous' as const,
      label: 'status.ambiguous' as const,
    },
    {
      amount: 34000,
      ref: 'R8K1',
      trx: 'BK2Y6C0VB4',
      tone: 'pending' as const,
      label: 'status.unmatched' as const,
    },
    {
      amount: 150000,
      ref: 'M4Q7',
      trx: 'BK8H1J5KD9',
      tone: 'matched' as const,
      label: 'status.matched' as const,
    },
  ]

  return (
    <Section
      title="Table density"
      hint="36px rows, px-3 py-2 cells, no zebra striping, border-b border-border/50, hover bg-accent."
    >
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="sticky top-0 z-10 flex h-8 items-center border-border border-b bg-background/95 px-3 text-micro text-muted-foreground backdrop-blur">
          <span className="w-20">Time</span>
          <span className="w-28 text-right">Amount</span>
          <span className="w-32 pl-6">Reference</span>
          <span className="flex-1 pl-6">TrxID</span>
          <span className="w-28">Status</span>
        </div>
        {rows.map((row, index) => (
          <div
            key={row.trx}
            className={cn(
              'flex h-row items-center border-border/50 border-b px-3 last:border-b-0',
              'hover:bg-accent',
              index === 2 && 'border-l-2 border-l-primary bg-accent',
            )}
          >
            <span className="figure w-20 text-small text-muted-foreground">
              {clock(new Date(base.getTime() - index * 74_000))}
            </span>
            <span className="amount w-28 text-right text-small">{amount(row.amount)}</span>
            <span className="figure w-32 pl-6 text-small">{row.ref}</span>
            <span className="figure flex-1 pl-6 text-small text-muted-foreground">{row.trx}</span>
            <span className="w-28">
              <StatusLabel tone={row.tone} labelKey={row.label} />
            </span>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-2 text-micro text-muted-foreground">
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3" />
        Row 3 shows the selected state: bg-accent with a 2px left primary border.
      </p>
    </Section>
  )
}
