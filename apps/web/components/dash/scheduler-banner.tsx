import Link from 'next/link'
import type { SchedulerHealth } from '@/lib/services/scheduler-health'

/**
 * Shown when the background jobs are not running, or their output is not
 * getting out.
 *
 * This is the alert that has to exist outside the alerting system. Every other
 * warning in this dashboard is raised by a scheduled job — heartbeat gaps,
 * capture silence, parse failures — which means the one fault none of them can
 * report is the scheduler being dead. When it is, webhooks queue and never
 * send, intents never expire and never release their reference codes, and no
 * detector anywhere says a word.
 *
 * That is not a hypothetical. An instance ran for two days with no worker and
 * no cron: twenty webhooks sat at zero attempts, two intents reported `open` a
 * day past their deadline, and the integrator only found out by querying their
 * own database and noticing that nothing had ever arrived. The dashboard looked
 * completely healthy the entire time.
 *
 * So it renders from the layout on every page load, which is a path that works
 * exactly when the scheduler does not, and it says which of the two failures it
 * is — because "start the worker" and "your endpoint is refusing connections"
 * need different people to do different things.
 */
export function SchedulerBanner({ health }: { health: SchedulerHealth }) {
  const stopped = health.silent

  return (
    <div className="border-ambiguous/40 border-b bg-ambiguous-subtle px-6 py-2.5 text-ambiguous-subtle-foreground">
      <p className="text-small">
        <strong>
          {stopped ? 'Background jobs are not running.' : 'Webhooks are not going out.'}
        </strong>{' '}
        {stopped ? <Stopped health={health} /> : <Backlogged health={health} />}
      </p>
    </div>
  )
}

/**
 * Never run and stopped-a-while-ago are the same fault with different first
 * guesses, so they get different sentences. A deployment that has never run a
 * job has almost certainly never been told to; one that ran an hour ago has
 * something that died.
 */
function Stopped({ health }: { health: SchedulerHealth }) {
  return (
    <>
      {health.neverRun
        ? 'Nothing has swept, expired an intent or delivered a webhook on this instance — not once.'
        : `Nothing has run for ${health.quietForMinutes} minutes.`}{' '}
      Payments still match, but nothing that happens on a timer is happening:{' '}
      <strong>webhooks are queued and not sent</strong>, intents past their deadline stay{' '}
      <code className="figure text-micro">open</code>, and no health alert can fire.
      {health.pendingDeliveries > 0 ? (
        <>
          {' '}
          {health.pendingDeliveries} {health.pendingDeliveries === 1 ? 'event is' : 'events are'}{' '}
          waiting.
        </>
      ) : null}{' '}
      Start the worker (<code className="figure text-micro">pnpm dev:worker</code>) or point a cron
      service at <code className="figure text-micro">POST /api/internal/sweep</code> —{' '}
      <Link href="/settings" className="underline underline-offset-2">
        Settings
      </Link>{' '}
      has the detail.
    </>
  )
}

/**
 * The scheduler is alive and delivery still is not landing — which in practice
 * means the endpoint is wrong or unreachable, and the operator is the only
 * person who can see that. The integrator's side of this is indistinguishable
 * from Jomma never having sent anything.
 */
function Backlogged({ health }: { health: SchedulerHealth }) {
  return (
    <>
      Jobs are running, but {health.unattemptedDeliveries + health.failedDeliveries}{' '}
      {health.unattemptedDeliveries + health.failedDeliveries === 1
        ? 'delivery is'
        : 'deliveries are'}{' '}
      overdue or given up. Check the endpoint URL is one this server can actually reach on{' '}
      <Link href="/apps" className="underline underline-offset-2">
        Apps
      </Link>
      , where the delivery history and the last error are listed.
    </>
  )
}
