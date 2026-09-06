import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { requireBusiness } from '@/lib/auth/tenancy'

/**
 * What a merchant sees while they are not live.
 *
 * The alternative — the ordinary dashboard, with every number at zero and every
 * action failing — is the outcome worth avoiding. It looks like a broken
 * product rather than a queue, and the support conversation that follows starts
 * from "nothing works".
 *
 * So this says which of the four states they are in, what it means, and what
 * they can still do. Rejected and suspended show the reason, which is why
 * `reviewBusiness` insists on one.
 */
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Awaiting approval' }

const COPY = {
  pending: {
    title: 'Waiting for approval',
    body:
      'Someone is reading your registration. You can add your bKash number, pair a phone and ' +
      'create an API key in the meantime — everything except receiving real money.',
    tone: 'text-amber-600 dark:text-amber-500',
  },
  rejected: {
    title: 'Registration declined',
    body: 'This business cannot take payments. The reason is below.',
    tone: 'text-red-600 dark:text-red-500',
  },
  suspended: {
    title: 'Suspended',
    body: 'Payments to this business are stopped. The reason is below.',
    tone: 'text-red-600 dark:text-red-500',
  },
} as const

export default async function PendingPage() {
  const { business } = await requireBusiness()

  // Approved while they were sitting here. Nothing to explain.
  if (business.live) redirect('/')

  const copy = COPY[business.status as keyof typeof COPY] ?? COPY.pending

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-6 p-6">
      <div className="space-y-2">
        <p className={`font-medium text-sm ${copy.tone}`}>{business.name}</p>
        <h1 className="font-semibold text-2xl tracking-tight">{copy.title}</h1>
        <p className="text-muted-foreground text-sm">{copy.body}</p>
      </div>

      {business.statusReason ? (
        <div className="rounded-lg border bg-muted/40 p-4">
          <p className="font-medium text-sm">Reason</p>
          <p className="mt-1 text-muted-foreground text-sm">{business.statusReason}</p>
        </div>
      ) : null}

      <div className="flex gap-2">
        {/*
         * Still a way in. Setting up while you wait is the whole point of
         * gating the money rather than the account.
         */}
        <Link href="/setup" className={buttonVariants({ variant: 'outline', className: 'flex-1' })}>
          Carry on setting up
        </Link>
        <Link
          href="/businesses/new"
          className={buttonVariants({ variant: 'ghost', className: 'flex-1' })}
        >
          Register another
        </Link>
      </div>
    </div>
  )
}
