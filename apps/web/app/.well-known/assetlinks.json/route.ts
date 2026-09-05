import { appLinkFingerprints } from '@/lib/services/app-links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /.well-known/assetlinks.json — Android App Links verification.
 *
 * The domain vouching for the app. Android fetches this when the notifier is
 * installed, and only if it finds the app's own signing certificate here does
 * it agree to send `https://<host>/pair/…` straight to the app rather than to a
 * browser.
 *
 * That is the mechanism behind "no other app can process the QR". Since Android
 * 12, verification is not advisory: an app that cannot prove the domain
 * endorses it does not get the link, and cannot register for it either. A
 * malicious app can still register a custom `jomma://` scheme, which is exactly
 * why the QR does not use one.
 *
 * The fingerprints come from `lib/services/app-links.ts`, shared with the
 * dashboard so its warning cannot disagree with what is actually served.
 */
export function GET() {
  const fingerprints = appLinkFingerprints()

  const statements =
    fingerprints.length === 0
      ? []
      : [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: 'com.jomma.notifier',
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]

  return new Response(JSON.stringify(statements, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      /*
       * Android re-fetches this to verify, and an operator who has just pasted
       * a fingerprint in should not have to wait out a CDN. It is a handful of
       * bytes read once per install.
       */
      'cache-control': 'no-store',
    },
  })
}
