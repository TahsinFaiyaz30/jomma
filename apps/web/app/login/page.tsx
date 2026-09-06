import { isServiceMode } from '@jomma/shared/env'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdmin } from '@/lib/auth/session'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  // Already signed in — no reason to show the form again.
  if (await getAdmin()) redirect('/')

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="text-micro font-semibold">জ</span>
            </div>
            <span className="text-title font-medium">Jomma</span>
          </div>
          <p className="text-muted-foreground text-small">
            {isServiceMode()
              ? 'Sign in to your dashboard.'
              : 'Admin access only. Accounts are created from the server, never here.'}
          </p>
        </div>

        <LoginForm />

        {/*
          Only in service mode. Self-hosted, signup is disabled server-side, so
          a link here would lead to a form that always fails.
        */}
        {isServiceMode() ? (
          <p className="text-muted-foreground text-small">
            New here?{' '}
            <Link href="/signup" className="underline underline-offset-4">
              Create an account
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  )
}
