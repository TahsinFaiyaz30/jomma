import { isServiceMode } from '@jomma/shared/env'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdmin } from '@/lib/auth/session'
import { SignupForm } from './signup-form'

export const metadata: Metadata = { title: 'Create an account' }
export const dynamic = 'force-dynamic'

export default async function SignupPage() {
  /*
   * Self-hosted, there is no public registration and this page does not exist.
   * A 404 rather than a message: an instance run by one shop should not
   * advertise a door it has deliberately bricked up.
   */
  if (!isServiceMode()) redirect('/login')
  if (await getAdmin()) redirect('/')

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="font-semibold text-micro">জ</span>
            </div>
            <span className="font-medium text-title">Jomma</span>
          </div>
          <p className="text-muted-foreground text-small">
            Create an account, then register your business. Taking payments needs an approval;
            setting everything up does not.
          </p>
        </div>

        <SignupForm />

        <p className="text-muted-foreground text-small">
          Already have an account?{' '}
          <Link href="/login" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
