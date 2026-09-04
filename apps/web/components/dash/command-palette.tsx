'use client'

import {
  Activity01Icon,
  ComputerIcon,
  Layers01Icon,
  ListViewIcon,
  Moon02Icon,
  RefreshIcon,
  Settings02Icon,
  SourceCodeIcon,
  Sun03Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useState } from 'react'
import { type PaletteHit, paletteSearch } from '@/app/(dash)/search-actions'
import { StatusDot } from '@/components/status'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import type { MessageKey } from '@/lib/i18n/messages'
import { useI18n } from '@/lib/i18n/provider'
import { INTENT_STATUS_META, PAYMENT_STATUS_META } from '@/lib/status'

/**
 * cmd+k.
 *
 * Two jobs, in the order an operator needs them. Typing anything that looks like
 * an identifier searches the database — a TrxID off a screenshot, a reference
 * code somebody read out over the phone — because that is the actual question
 * being asked at 11pm. Navigation sits underneath, for when it is not.
 *
 * Mounted in the dashboard layout so it is available on every page. The feed's
 * own `/` and `j`/`k` handlers already ignore events while an input has focus,
 * so they do not fight with the palette.
 */

const NAV: Array<{ href: string; labelKey: MessageKey; icon: unknown }> = [
  { href: '/', labelKey: 'nav.feed', icon: Activity01Icon },
  { href: '/queue', labelKey: 'nav.queue', icon: ListViewIcon },
  { href: '/intents', labelKey: 'nav.intents', icon: Layers01Icon },
  { href: '/accounts', labelKey: 'nav.accounts', icon: Wallet01Icon },
  { href: '/reconcile', labelKey: 'nav.reconcile', icon: RefreshIcon },
  { href: '/apps', labelKey: 'nav.apps', icon: SourceCodeIcon },
  { href: '/settings', labelKey: 'nav.settings', icon: Settings02Icon },
]

/** Long enough that typing a reference does not fire four queries. */
const DEBOUNCE_MS = 180

/**
 * How the sidebar button opens the palette.
 *
 * A window event rather than a context provider: the palette owns its own open
 * state, one component needs to poke it, and a provider wrapping the entire
 * dashboard to carry a single boolean is more plumbing than the problem.
 */
const OPEN_EVENT = 'jomma:command-palette'

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

export function CommandPalette() {
  const router = useRouter()
  const { t, amount } = useI18n()
  const { setTheme } = useTheme()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PaletteHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((previous) => !previous)
      }
    }

    const onRequest = () => setOpen(true)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(OPEN_EVENT, onRequest)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(OPEN_EVENT, onRequest)
    }
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setHits([])
      setSearching(false)
      return
    }

    setSearching(true)
    let cancelled = false

    const timer = setTimeout(() => {
      paletteSearch(trimmed)
        .then((results) => {
          // A slow query for an older keystroke must not overwrite a newer one.
          if (!cancelled) setHits(results)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      setQuery('')
      // Query strings on a typed route: the destinations are all literal paths,
      // the parameter is what varies.
      router.push(href as Parameters<typeof router.push>[0])
    },
    [router],
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t('action.commandPalette')}
      description={t('feed.search')}
      className="max-w-xl"
    >
      <Command>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('feed.search')}
          autoFocus
        />
        <CommandList className="max-h-96">
          <CommandEmpty>
            {searching ? '…' : query.trim().length >= 2 ? 'Nothing matches.' : 'Type to search.'}
          </CommandEmpty>

          {hits.length > 0 ? (
            <>
              <CommandGroup heading="Matches">
                {hits.map((hit) => (
                  <CommandItem
                    key={`${hit.kind}-${hit.id}`}
                    /*
                     * The query is part of the value on purpose. The search has
                     * already run server-side, and cmdk's own fuzzy filter would
                     * otherwise hide a row whose match was on a column that is
                     * not rendered — the sender's number, for instance.
                     */
                    value={`${hit.primary} ${hit.secondary} ${query}`}
                    onSelect={() =>
                      go(
                        hit.kind === 'intent'
                          ? `/intents?q=${encodeURIComponent(hit.primary || hit.id)}`
                          : `/?q=${encodeURIComponent(hit.primary)}`,
                      )
                    }
                  >
                    <StatusDot
                      tone={
                        hit.kind === 'intent'
                          ? (INTENT_STATUS_META[hit.status as keyof typeof INTENT_STATUS_META]
                              ?.tone ?? 'neutral')
                          : (PAYMENT_STATUS_META[hit.status as keyof typeof PAYMENT_STATUS_META]
                              ?.tone ?? 'neutral')
                      }
                    />
                    <span className="figure">{hit.primary}</span>
                    <span className="truncate text-micro text-muted-foreground">
                      {hit.secondary}
                    </span>
                    <span className="amount ml-auto text-small">{amount(hit.amountCents)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          <CommandGroup heading={t('action.open')}>
            {NAV.map((item) => (
              <CommandItem
                key={item.href}
                value={`${t(item.labelKey)} ${item.href}`}
                onSelect={() => go(item.href)}
              >
                <HugeiconsIcon icon={item.icon as never} strokeWidth={2} className="size-4" />
                <span>{t(item.labelKey)}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={t('theme.label')}>
            <CommandItem
              value={`${t('theme.label')} ${t('theme.light')}`}
              onSelect={() => {
                setTheme('light')
                setOpen(false)
              }}
            >
              <HugeiconsIcon icon={Sun03Icon} strokeWidth={2} className="size-4" />
              <span>{t('theme.light')}</span>
            </CommandItem>
            <CommandItem
              value={`${t('theme.label')} ${t('theme.dark')}`}
              onSelect={() => {
                setTheme('dark')
                setOpen(false)
              }}
            >
              <HugeiconsIcon icon={Moon02Icon} strokeWidth={2} className="size-4" />
              <span>{t('theme.dark')}</span>
            </CommandItem>
            <CommandItem
              value={`${t('theme.label')} ${t('theme.system')}`}
              onSelect={() => {
                setTheme('system')
                setOpen(false)
              }}
            >
              <HugeiconsIcon icon={ComputerIcon} strokeWidth={2} className="size-4" />
              <span>{t('theme.system')}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
