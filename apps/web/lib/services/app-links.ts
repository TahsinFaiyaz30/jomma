import { env } from '@jomma/shared/env'

/**
 * Which app certificates this instance vouches for.
 *
 * One definition, because two things read it and they must agree: the
 * `/.well-known/assetlinks.json` route that Android fetches, and the dashboard,
 * which warns when a provisioning QR will not open in the app. A dashboard that
 * says "configured" while the served file is empty is worse than no warning —
 * it sends someone looking for the problem somewhere else.
 *
 * A fingerprint is not a secret. Publishing it at a well-known URL is its whole
 * purpose, so the release key this repository signs with is committed as the
 * default and `ANDROID_CERT_SHA256` overrides it. A fork signing its own APK
 * sets that variable; everyone else gets a working deployment without having to
 * discover the setting exists.
 */
const DEFAULT_FINGERPRINT =
  '41:BD:CB:9A:9B:C8:66:CD:96:A3:78:80:F6:17:B3:CA:15:D5:16:A3:BF:B4:B1:CF:E1:15:EC:B2:A1:82:B1:E1'

/** `AA:BB:…` thirty-two hex pairs. Anything else is a paste that went wrong. */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

export function appLinkFingerprints(): string[] {
  const configured = env().ANDROID_CERT_SHA256.trim()

  return (
    (configured.length > 0 ? configured : DEFAULT_FINGERPRINT)
      .split(',')
      .map((value) => value.trim().toUpperCase())
      // Tolerate lowercase and stray whitespace out of keytool, but not a value
      // that is not a fingerprint — publishing garbage would fail verification
      // in a way that looks identical to publishing nothing.
      .filter((value) => FINGERPRINT.test(value))
  )
}

/**
 * Whether a QR scanned by some other app will actually open the notifier.
 *
 * False only when someone has set `ANDROID_CERT_SHA256` to something malformed,
 * since the default is valid. Worth surfacing anyway: that mistake is silent
 * everywhere else.
 */
export function appLinksConfigured(): boolean {
  return appLinkFingerprints().length > 0
}
