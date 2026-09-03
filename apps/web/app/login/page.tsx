import type { Metadata } from 'next'
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
          <p className="text-small text-muted-foreground">
            Admin access only. Accounts are created from the server, never here.
          </p>
        </div>

        <LoginForm />
      </div>
    </main>
  )
}
