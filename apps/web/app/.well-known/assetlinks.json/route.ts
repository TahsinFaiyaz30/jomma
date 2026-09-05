import { env } from '@jomma/shared/env'

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
 * Served from a route rather than a static file because the fingerprint belongs
 * to whoever built the APK. This is self-hosted software — there is no single
 * signing key to check in, and hardcoding one would authorise a build the
 * operator does not control.
 *
 * With `ANDROID_CERT_SHA256` unset this returns `[]`. That is a valid statement
 * list meaning "this domain authorises no app", which is the right default:
 * links then open in a browser and land on the `/pair` page, instead of the
 * domain silently endorsing whatever was installed.
 */
export function GET() {
  const fingerprints = env()
    .ANDROID_CERT_SHA256.split(',')
    .map((value) => value.trim().toUpperCase())
    // Tolerate lowercase and stray whitespace from a copy-paste out of keytool,
    // but not a value that is not a fingerprint at all.
    .filter((value) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))

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
