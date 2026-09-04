'use client'

import {
  Activity01Icon,
  Layers01Icon,
  ListViewIcon,
  RefreshIcon,
  SearchIcon,
  Settings02Icon,
  SourceCodeIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Kbd } from '@/components/ui/kbd'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import type { MessageKey } from '@/lib/i18n/messages'
import { useI18n } from '@/lib/i18n/provider'
import type { SidebarCounts } from '@/lib/services/dashboard'
import { type AccountFooterItem, AccountHealthFooter } from './account-health'
import { openCommandPalette } from './command-palette'
import { UserMenu } from './user-menu'

/**
 * Counts live on nav items as badges, where they are always visible — not as KPI
 * tiles across the top of the feed competing with the content.
 */
const NAV = [
  { href: '/', labelKey: 'nav.feed', icon: Activity01Icon, badge: 'feed' },
  { href: '/queue', labelKey: 'nav.queue', icon: ListViewIcon, badge: 'queue' },
  {
    href: '/intents',
    labelKey: 'nav.intents',
    icon: Layers01Icon,
    badge: 'intents',
  },
  {
    href: '/accounts',
    labelKey: 'nav.accounts',
    icon: Wallet01Icon,
    badge: null,
  },
  {
    href: '/reconcile',
    labelKey: 'nav.reconcile',
    icon: RefreshIcon,
    badge: null,
  },
  { href: '/apps', labelKey: 'nav.apps', icon: SourceCodeIcon, badge: null },
  {
    href: '/settings',
    labelKey: 'nav.settings',
    icon: Settings02Icon,
    badge: null,
  },
] as const satisfies ReadonlyArray<{
  href: string
  labelKey: MessageKey
  icon: unknown
  badge: keyof SidebarCounts | null
}>

export function AppSidebar({
  counts,
  accounts,
  admin,
}: {
  counts: SidebarCounts
  accounts: AccountFooterItem[]
  admin: { name: string; email: string }
}) {
  const pathname = usePathname()
  const { t, number } = useI18n()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="text-micro font-semibold">জ</span>
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-small font-medium">{t('app.name')}</div>
            <div className="truncate text-micro text-sidebar-foreground/60">{t('app.tagline')}</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* The shortcut is printed next to it so it is discoverable
                  rather than folklore. */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={`${t('action.commandPalette')} · ⌘K`}
                  onClick={openCommandPalette}
                >
                  <HugeiconsIcon icon={SearchIcon} strokeWidth={2} className="size-4" />
                  <span>{t('action.search')}</span>
                  <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">⌘K</Kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {NAV.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
                const badgeValue = item.badge ? counts[item.badge] : 0

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={t(item.labelKey)}
                      render={
                        <Link href={item.href}>
                          <HugeiconsIcon
                            icon={item.icon as never}
                            strokeWidth={2}
                            className="size-4"
                          />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      }
                    />
                    {badgeValue > 0 ? (
                      <SidebarMenuBadge
                        className={
                          item.badge === 'queue'
                            ? 'bg-ambiguous-subtle text-ambiguous-subtle-foreground'
                            : undefined
                        }
                      >
                        {number(badgeValue)}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <div className="px-2 pt-1 pb-0.5 text-micro text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
          {t('account.health')}
        </div>
        <div className="group-data-[collapsible=icon]:hidden">
          <AccountHealthFooter accounts={accounts} />
        </div>

        <UserMenu admin={admin} />
      </SidebarFooter>
    </Sidebar>
  )
}
