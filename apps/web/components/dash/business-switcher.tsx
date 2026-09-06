'use client'

import { Check, ChevronsUpDown, Plus, Shield } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { switchBusinessAction } from '@/app/(dash)/switch-business'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface SwitcherBusiness {
  id: string
  name: string
  status: string
  live: boolean
}

/**
 * Which merchant the dashboard is showing.
 *
 * Rendered only in service mode. Self-hosted there is one business and it has
 * no name worth showing — a switcher with a single entry is a control that
 * teaches you it does nothing.
 *
 * The status dot is not decoration. A business awaiting approval looks
 * identical to a live one from inside the dashboard until a payment fails, and
 * someone running two of them needs to know at a glance which is which.
 */
export function BusinessSwitcher({
  active,
  businesses,
  isPlatformAdmin,
}: {
  active: SwitcherBusiness
  businesses: SwitcherBusiness[]
  isPlatformAdmin: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const choose = (businessId: string) => {
    if (businessId === active.id) return

    startTransition(async () => {
      const result = await switchBusinessAction(businessId)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Everything on screen was scoped to the old business, so nothing on it
      // is still true.
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent"
      >
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="font-semibold text-micro">জ</span>
        </div>
        <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-small">{active.name}</span>
            {active.live ? null : <Dot />}
          </div>
          <div className="truncate text-micro text-sidebar-foreground/60">
            {active.live ? 'Live' : active.status}
          </div>
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-50 group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        {/*
          Base UI requires a GroupLabel to sit inside a Group — outside one it
          throws at render rather than degrading, so the wrapper is load-bearing
          rather than decorative.
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-micro text-muted-foreground">
            Businesses
          </DropdownMenuLabel>

          {businesses.map((business) => (
            <DropdownMenuItem
              key={business.id}
              onSelect={() => choose(business.id)}
              className="gap-2"
            >
              <span className="min-w-0 flex-1 truncate">{business.name}</span>
              {business.live ? null : <Dot />}
              {business.id === active.id ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem className="gap-2" onSelect={() => router.push('/businesses/new')}>
          <Plus className="size-3.5" />
          Register another
        </DropdownMenuItem>

        {isPlatformAdmin ? (
          <DropdownMenuItem className="gap-2" onSelect={() => router.push('/admin')}>
            <Shield className="size-3.5" />
            Platform console
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Not live. Amber rather than red — waiting is not the same as broken. */
function Dot() {
  return <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
}
