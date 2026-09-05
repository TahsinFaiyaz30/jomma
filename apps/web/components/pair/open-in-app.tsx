'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Hands a pairing link off to the notifier app from a browser.
 *
 * This page is only ever reached when App Links did *not* take the link — the
 * app is not installed, or Android has not verified the domain yet, which on a
 * fresh install can lag behind by minutes while the verifier does its round
 * trip. Without this, "scan it with any scanner" quietly becomes "scan it and
 * then read a page" for that window.
 *
 * The `intent://` URL names `package=com.jomma.notifier`, so Android delivers
 * it to that package or to nothing at all. No chooser, no other app, and no
 * dependence on domain verification — which is the point, because verification
 * is exactly what is missing whenever this component runs.
 *
 * Deliberately **not** a `jomma://` scheme. Any app can claim a custom scheme;
 * an explicit package cannot be claimed by anyone else.
 */
export function OpenInApp({ code }: { code: string }) {
  const [attempted, setAttempted] = useState(false)

  const intentUrl =
    `intent://${typeof window === 'undefined' ? '' : window.location.host}/pair/${code}` +
    '#Intent;scheme=https;package=com.jomma.notifier;end'

  /*
   * One automatic attempt, then never again for this code.
   *
   * If the app is not installed the browser stays put and the instructions
   * below are the answer, so retrying on every render would only produce a page
   * that flickers at someone who is trying to read it. sessionStorage rather
   * than state because a failed intent navigation can reload the page.
   */
  useEffect(() => {
    const key = `jomma:pair-handoff:${code}`
    if (sessionStorage.getItem(key)) {
      setAttempted(true)
      return
    }
    sessionStorage.setItem(key, '1')
    setAttempted(true)
    window.location.href = intentUrl
  }, [code, intentUrl])

  return (
    <div className="space-y-2">
      <Button
        onClick={() => {
          window.location.href = intentUrl
        }}
        className="w-full"
      >
        Open in the Jomma app
      </Button>
      {attempted ? (
        <p className="text-micro text-muted-foreground">
          If nothing happened, the app is not installed on this phone yet.
        </p>
      ) : null}
    </div>
  )
}
