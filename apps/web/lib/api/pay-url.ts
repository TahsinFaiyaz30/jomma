/**
 * The intent id out of a `/api/pay/:id/...` URL.
 *
 * `route` owns the handler signature so it can guarantee a request id on every
 * path, which means dynamic segments are read off the URL rather than taken as
 * a second argument. Same pattern as `idFromUrl` for `/v1/intents/:id`, kept
 * here so the three pay routes share one copy.
 */
export function intentIdFromPayUrl(url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean)
  const index = segments.indexOf('pay')
  return index >= 0 ? (segments[index + 1] ?? '') : ''
}
