import 'server-only'

/**
 * Redirect targets for the hosted pay page.
 *
 * The buyer has been told to trust this page with a payment. An unchecked
 * `return_url` on it is an open redirect on exactly the page where a phishing
 * hand-off does the most damage — the buyer has their bKash app open and is
 * already in the habit of following instructions.
 *
 * So: the app registers its hostnames, and nothing outside that list is ever
 * rendered as a link or followed as a redirect. An app with no registered hosts
 * gets no redirect at all rather than any redirect it asks for.
 */

/** Case-insensitive, and a registered apex covers its subdomains. */
function hostMatches(host: string, allowed: string): boolean {
  const target = host.toLowerCase()
  const pattern = allowed.trim().toLowerCase().replace(/^\*\./, '')
  if (!pattern) return false
  return target === pattern || target.endsWith(`.${pattern}`)
}

export function isAllowedRedirect(url: string | null, allowedHosts: string[]): boolean {
  if (!url || allowedHosts.length === 0) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // Belt and braces with the Zod schema. This function is also called on the
  // render path, where the value came out of the database rather than off a
  // request, and a column is not a validator.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  return allowedHosts.some((allowed) => hostMatches(parsed.hostname, allowed))
}

/** The URL if it is allowed, otherwise null. Never throws. */
export function safeRedirect(url: string | null, allowedHosts: string[]): string | null {
  return isAllowedRedirect(url, allowedHosts) ? url : null
}
