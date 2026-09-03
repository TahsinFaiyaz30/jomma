'use client'

import { MoreVerticalIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LocaleToggleItems } from '@/components/locale-toggle'
import { ThemeToggleItems } from '@/components/theme-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { signOut } from '@/lib/auth/client'
import { useI18n } from '@/lib/i18n/provider'

/**
 * Theme and language live here rather than in the top bar — they are set once,
 * not adjusted, and the top bar belongs to the payment stream.
 */
export function UserMenu({ admin }: { admin: { name: string; email: string } }) {
  const { t } = useI18n()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton className="mt-1">
            <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} className="size-4" />
            <span className="truncate">{admin.name}</span>
          </SidebarMenuButton>
        }
      />
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-small">{admin.name}</div>
          <div className="truncate text-micro text-muted-foreground">{admin.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuLabel>{t('theme.label')}</DropdownMenuLabel>
        <ThemeToggleItems />
        <DropdownMenuSeparator />

        <DropdownMenuLabel>{t('locale.label')}</DropdownMenuLabel>
        <LocaleToggleItems />
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
