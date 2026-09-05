import Link from 'next/link'

/**
 * Shown when a configured instance currently cannot take a payment.
 *
 * Deliberately a banner and not a redirect. This state is reached by ordinary
 * operations — taking a number out of rotation while its phone is away,
 * revoking a leaked key — and an operator doing that on purpose should not lose
 * the dashboard. It is also reached by accident, and then it is the single most
 * important thing on the screen, because checkout is returning
 * `503 no_healthy_account` to every store pointed at this instance.
 *
 * So: loud, permanent while true, and never dismissible. Dismissing it would
 * only hide the reason payments are failing.
 */
export function NotPayableBanner() {
  return (
    <div className="border-ambiguous/40 border-b bg-ambiguous-subtle px-6 py-2.5 text-ambiguous-subtle-foreground">
      <p className="text-small">
        <strong>Not accepting payments.</strong> Checkout is returning{' '}
        <code className="figure text-micro">503 no_healthy_account</code> — there is no routable
        receiving account with a paired phone, or no live API key.{' '}
        <Link href="/setup" className="underline underline-offset-2">
          Review setup
        </Link>{' '}
        or fix it on{' '}
        <Link href="/accounts" className="underline underline-offset-2">
          Accounts
        </Link>
        .
      </p>
    </div>
  )
}
