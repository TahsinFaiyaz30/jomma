'use client'

import { Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StatusDot } from '@/components/status'
import { Input } from '@/components/ui/input'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/lib/i18n/provider'
import type { FeedRow } from '@/lib/services/dashboard'
import type { StatusTone } from '@/lib/status'
import { TONE_CLASSES } from '@/lib/status'
import { cn } from '@/lib/utils'
import { FeedDetailSheet } from './feed-detail'

const ROW_HEIGHT = 36
const POLL_INTERVAL_MS = 2500
/** How long a newly arrived row stays visually marked as new. */
const ARRIVAL_HIGHLIGHT_MS = 4000

interface FeedTableProps {
  initialRows: FeedRow[]
  initialCursor: string | null
}

/**
 * The hero of the product: a live stream of incoming payments, newest first.
 *
 * No KPI tiles above it. The first thing on screen is the payment stream.
 */
export function FeedTable({ initialRows, initialCursor }: FeedTableProps) {
  const { t, amount, clock, number } = useI18n()
  const reduceMotion = useReducedMotion()

  const [rows, setRows] = useState<FeedRow[]>(initialRows)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [live, setLive] = useState(true)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [openRow, setOpenRow] = useState<FeedRow | null>(null)
  const [arrivals, setArrivals] = useState<Set<string>>(new Set())
  const [announcement, setAnnouncement] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  /* ── Live updates ───────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!live) return

    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/dash/feed${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`,
          { cache: 'no-store' },
        )
        if (!response.ok || cancelled) return
        const page = (await response.json()) as {
          rows: FeedRow[]
          cursor: string | null
        }
        if (cancelled || page.rows.length === 0) return

        setRows((previous) => {
          const seen = new Set(previous.map((row) => row.id))
          const fresh = page.rows.filter((row) => !seen.has(row.id))
          if (fresh.length === 0) return previous
          return [...fresh, ...previous]
        })

        const freshIds = page.rows.map((row) => row.id)
        setArrivals((previous) => new Set([...previous, ...freshIds]))
        setCursor(page.cursor)

        // Live region: screen readers announce arrivals rather than the reader
        // discovering them by chance on the next scroll.
        const newest = page.rows[0]
        if (newest?.amountCents != null) {
          setAnnouncement(`${t('feed.announce')} ${amount(newest.amountCents)}`)
        }
      } catch {
        // A transient poll failure is not worth surfacing; the next tick retries.
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [live, cursor, amount, t])

  // Arrivals stop being "new" after a few seconds so the highlight does not
  // accumulate into permanent visual noise.
  useEffect(() => {
    if (arrivals.size === 0) return
    const timer = setTimeout(() => setArrivals(new Set()), ARRIVAL_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [arrivals])

  /* ── Search ─────────────────────────────────────────────────────────────── */

  const filtered = useMemo(() => {
    const needle = query.trim().toUpperCase()
    if (!needle) return rows
    return rows.filter((row) =>
      [row.trxId, row.reference, row.senderMsisdn, row.intentReference, row.accountLabel]
        .filter(Boolean)
        .some((field) => (field as string).toUpperCase().includes(needle)),
    )
  }, [rows, query])

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  /* ── Virtualisation ─────────────────────────────────────────────────────── */

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const focusRow = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, filtered.length - 1))
      setActiveIndex(clamped)
      virtualizer.scrollToIndex(clamped, { align: 'auto' })
    },
    [filtered.length, virtualizer],
  )

  /* ── Keyboard ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable

      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }

      if (event.key === 'Escape') {
        if (openRow) setOpenRow(null)
        else if (typing) (target as HTMLInputElement).blur()
        return
      }

      if (typing) return

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          focusRow(activeIndex + 1)
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          focusRow(activeIndex - 1)
          break
        case 'Enter': {
          event.preventDefault()
          const row = filtered[activeIndex]
          if (row) setOpenRow(row)
          break
        }
        case 'g':
          event.preventDefault()
          focusRow(0)
          break
        case 'G':
          event.preventDefault()
          focusRow(filtered.length - 1)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, filtered, focusRow, openRow])

  const items = virtualizer.getVirtualItems()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar
        query={query}
        onQueryChange={setQuery}
        searchRef={searchRef}
        live={live}
        onToggleLive={() => setLive((value) => !value)}
        count={filtered.length}
      />

      {/* Live region. Polite so it does not interrupt whatever is being read. */}
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className="h-full overflow-auto"
          // a real <table> cannot be virtualised — rows are absolutely positioned inside a sized spacer, which a table layout does not allow. role=grid plus aria-rowcount/aria-rowindex is the documented alternative. */}
          role="grid"
          aria-rowcount={filtered.length}
          aria-label={t('feed.title')}
          tabIndex={-1}
        >
          <HeaderRow />

          {filtered.length === 0 ? (
            <EmptyState hasQuery={query.trim().length > 0} />
          ) : (
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              <AnimatePresence initial={false}>
                {items.map((item) => {
                  const row = filtered[item.index]
                  if (!row) return null
                  const isNew = arrivals.has(row.id)

                  return (
                    <motion.div
                      key={row.id}
                      // The entire motion budget for this page: fade plus a 4px
                      // translate, spring 400/30. You should notice something
                      // arrived, and nothing more.
                      initial={
                        isNew && !reduceMotion ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }
                      }
                      animate={{ opacity: 1, y: 0 }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 400, damping: 30 }
                      }
                      className="absolute left-0 w-full"
                      // Positioned with `top`, not `translateY`. Motion animates
                      // `y`, which writes to `transform` — using transform for
                      // the virtualiser offset too means the entrance animation
                      // overwrites it and every row stacks at y=0.
                      style={{ height: ROW_HEIGHT, top: item.start }}
                    >
                      <Row
                        row={row}
                        index={item.index}
                        active={item.index === activeIndex}
                        isNew={isNew}
                        onSelect={() => {
                          setActiveIndex(item.index)
                          setOpenRow(row)
                        }}
                        amount={amount}
                        clock={clock}
                      />
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      <StatusBar count={filtered.length} total={rows.length} number={number} />

      <FeedDetailSheet row={openRow} onClose={() => setOpenRow(null)} />
    </div>
  )
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function Toolbar({
  query,
  onQueryChange,
  searchRef,
  live,
  onToggleLive,
  count,
}: {
  query: string
  onQueryChange: (value: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  live: boolean
  onToggleLive: () => void
  count: number
}) {
  const { t } = useI18n()

  return (
    <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-2">
      <div className="relative min-w-0 flex-1 max-w-sm">
        <HugeiconsIcon
          icon={Search01Icon}
          strokeWidth={2}
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground"
        />
        <Input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('feed.search')}
          className="h-7 pl-8 text-small"
          aria-label={t('feed.search')}
        />
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onToggleLive}
              aria-pressed={live}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-micro transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                live ? 'text-matched-subtle-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <StatusDot tone={live ? 'matched' : 'neutral'} />
              {live ? t('feed.live') : t('feed.paused')}
            </button>
          }
        />
        <TooltipContent side="bottom">
          {live ? 'Polling every 2.5s. Click to pause.' : 'Paused. Click to resume.'}
        </TooltipContent>
      </Tooltip>

      <span className="hidden items-center gap-3 text-micro text-muted-foreground sm:inline-flex">
        <span className="inline-flex items-center gap-1">
          <KbdGroup>
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
          </KbdGroup>
          {t('shortcut.move')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>enter</Kbd>
          {t('shortcut.open')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>/</Kbd>
          {t('shortcut.search')}
        </span>
      </span>

      <span className="sr-only">{count} rows</span>
    </div>
  )
}

/** Sticky, blurred, and sized to the same grid as the rows below it. */
function HeaderRow() {
  const { t } = useI18n()
  return (
    <div className="sticky top-0 z-10 flex h-8 items-center border-border border-b bg-background/95 px-3 text-micro text-muted-foreground backdrop-blur">
      <span className="w-[72px] shrink-0">{t('feed.column.time')}</span>
      <span className="w-[104px] shrink-0 text-right">{t('feed.column.amount')}</span>
      <span className="w-[128px] shrink-0 pl-4">{t('feed.column.sender')}</span>
      <span className="w-[72px] shrink-0 pl-4">{t('feed.column.reference')}</span>
      <span className="hidden min-w-0 flex-1 pl-4 md:block">TrxID</span>
      <span className="w-[120px] shrink-0 pl-4">{t('feed.column.status')}</span>
      <span className="hidden w-[120px] shrink-0 pl-4 lg:block">{t('feed.column.account')}</span>
    </div>
  )
}

function toneFor(row: FeedRow): { tone: StatusTone; label: string } {
  if (row.parseStatus === 'failed') return { tone: 'offline', label: 'Parse failed' }
  if (row.status === 'matched') return { tone: 'matched', label: 'Matched' }
  if (row.status === 'refunded') return { tone: 'neutral', label: 'Refunded' }
  if (row.status === 'orphaned') return { tone: 'ambiguous', label: 'Orphaned' }
  if (row.transactionType && row.transactionType !== 'send_money') {
    return { tone: 'ambiguous', label: 'Wrong type' }
  }
  // Unmatched is normal and expected. Amber, never red.
  return { tone: 'pending', label: 'Unmatched' }
}

function Row({
  row,
  index,
  active,
  isNew,
  onSelect,
  amount,
  clock,
}: {
  row: FeedRow
  index: number
  active: boolean
  isNew: boolean
  onSelect: () => void
  amount: (poisha: number) => string
  clock: (value: string) => string
}) {
  const { tone, label } = toneFor(row)

  return (
    <button
      type="button"
      role="row"
      aria-rowindex={index + 1}
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        // 36px rows, px-3 py-2 cells, no zebra striping — a border does the
        // separating so it cannot compete with the status colour.
        'flex h-row w-full items-center border-border/50 border-b px-3 text-left',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        'hover:bg-accent',
        active && 'border-l-2 border-l-primary bg-accent pl-[10px]',
        isNew && !active && 'bg-matched-subtle/30',
      )}
    >
      <span className="figure w-[72px] shrink-0 text-micro text-muted-foreground">
        {clock(row.receivedAt)}
      </span>

      {/* Amounts stay in the interface sans with tabular figures, not mono. */}
      <span className="amount w-[104px] shrink-0 text-right text-small">
        {row.amountCents === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          amount(row.amountCents)
        )}
      </span>

      <span className="figure w-[128px] shrink-0 truncate pl-4 text-small text-muted-foreground">
        {row.senderMsisdn ?? '—'}
      </span>

      <span className="figure w-[72px] shrink-0 pl-4 text-small">{row.reference ?? '—'}</span>

      <span className="figure hidden min-w-0 flex-1 truncate pl-4 text-small text-muted-foreground md:block">
        {row.trxId ?? '—'}
      </span>

      {/* Dot plus label, never colour alone. */}
      <span className="flex w-[120px] shrink-0 items-center gap-1.5 pl-4">
        <StatusDot tone={tone} />
        <span className={cn('truncate text-small', TONE_CLASSES[tone].text)}>{label}</span>
      </span>

      <span className="hidden w-[120px] shrink-0 truncate pl-4 text-small text-muted-foreground lg:block">
        {row.accountLabel}
      </span>
    </button>
  )
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-20 text-center">
      <div className="text-body">{hasQuery ? 'No matching payments' : t('feed.empty.title')}</div>
      <div className="max-w-sm text-small text-muted-foreground">
        {hasQuery
          ? 'Search covers TrxID, reference, sender number, and client reference.'
          : t('feed.empty.description')}
      </div>
    </div>
  )
}

function StatusBar({
  count,
  total,
  number,
}: {
  count: number
  total: number
  number: (value: number) => string
}) {
  const { t } = useI18n()
  return (
    <div className="flex shrink-0 items-center justify-between border-border border-t px-3 py-1.5 text-micro text-muted-foreground">
      <span>
        {number(count)} {t('feed.rowCount')}
        {count !== total ? ` of ${number(total)}` : ''}
      </span>
      <span className="figure">Asia/Dhaka</span>
    </div>
  )
}
