import type { Metadata } from 'next'
import { OpenInApp } from '@/components/pair/open-in-app'
import { isPairingCodeLive } from '@/lib/services/devices'

export const dynamic = 'force-dynamic'

/**
 * Where a provisioning link lands when the app did not take it.
 *
 * Reaching this page in a browser means one of two things: the notifier app is
 * not installed, or it is installed but App Links verification has not been set
 * up on this deployment (`ANDROID_CERT_SHA256`). Either way the person is
 * holding a phone, has just scanned a QR, and something they expected to happen
 * did not.
 *
 * The page **never redeems the code**. It is one-time, and burning it here would
 * mean scanning it correctly a moment later fails — the worst possible outcome
 * for someone who has just been told to install an app. It only reports whether
 * the code is still live, so the answer to "do I need a fresh QR?" is on screen.
 *
 * The code stays in the URL and is never displayed. There is nothing to gain
 * from putting a credential in text a screenshot would capture.
 */
export const metadata: Metadata = {
  title: 'Pair this device',
  // A live provisioning code has no business in a search index or a preview.
  robots: { index: false, follow: false },
}

export default async function PairPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const live = await isPairingCodeLive(code)

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="font-medium text-title">
          {live ? 'Open this in the Jomma app' : 'This code has expired'}
        </h1>
        <p className="text-small text-muted-foreground">
          {live
            ? 'You scanned a device pairing code, but it opened here instead of in the notifier app — which means the app is not installed on this phone yet.'
            : 'Pairing codes last fifteen minutes and can only be used once. This one is spent.'}
        </p>
      </div>

      {live ? (
        <>
          <OpenInApp code={code} />
          <ol className="space-y-3 text-small">
            <li className="flex gap-3">
              <span className="figure text-muted-foreground">1</span>
              <span>Install the Jomma notifier app on this phone.</span>
            </li>
            <li className="flex gap-3">
              <span className="figure text-muted-foreground">2</span>
              <span>
                Open it and tap <strong>Scan provisioning code</strong>, then point the camera at
                the same QR. You can also pick a screenshot of it.
              </span>
            </li>
          </ol>
        </>
      ) : (
        <p className="text-small">
          Go back to <strong>Accounts</strong> in the dashboard, add a device, and scan the new code
          it shows.
        </p>
      )}

      <p className="border-border border-t pt-4 text-micro text-muted-foreground">
        {live
          ? 'Nothing has been used up — this page does not consume the code, so the QR still works.'
          : 'Nothing was set up on this phone.'}
      </p>
    </main>
  )
}
