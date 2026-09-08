'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Keeps every dashboard page current without anybody pressing reload.
 *
 * Almost everything on this dashboard is written by something that is not the
 * browser looking at it: a phone heartbeats, reports its SIMs, claims a number,
 * goes quiet; a payment arrives; a webhook fails and retries. The pages were
 * server-rendered once and then sat there, so the answer to "has the phone
 * picked that up yet?" was always "reload and find out" — and a screen that is
 * wrong in a way you cannot see is worse than one that says it does not know.
 *
 * `router.refresh()` rather than a bespoke endpoint per page. It re-runs the
 * server components for whatever route is open and streams the result in, so
 * one component covers every page and there is no second description of the
 * data that can drift from the first. Client state survives it, which is the
 * property that matters here: a half-typed webhook URL, an open dialog and a
 * switch someone is holding are all still there afterwards.
 *
 * ## Why it is not simply a five-second timer
 *
 * Because it costs someone money. Each refresh re-runs every query on the
 * route plus the layout's own, and the reference deployment is a free Render
 * instance in front of a Neon database with a compute allowance. A background
 * tab left open overnight would spend that allowance on nobody, so:
 *
 *  - hidden tab: nothing at all, and one immediate refresh on return, so
 *    coming back to it is current rather than merely soon-to-be;
 *  - visible but not focused — a second monitor, which is where this actually
 *    lives — slower;
 *  - focused: [ACTIVE_MS], which is about as long as somebody will watch a
 *    phone's status without deciding the page is broken.
 */
export function LiveRefresh() {
  const router = useRouter()

  /*
   * The timer id, kept out of state on purpose: rescheduling must not itself
   * cause a render, or every refresh would queue another one.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let stopped = false

    const delay = () => {
      if (document.visibilityState !== 'visible') return null
      return document.hasFocus() ? ACTIVE_MS : BACKGROUND_MS
    }

    const tick = () => {
      if (stopped) return
      const wait = delay()
      if (wait === null) return // Hidden. `onVisibility` restarts it.
      timer.current = setTimeout(() => {
        if (stopped) return
        // Skipped while the tab is hidden even if a timer slipped through, so a
        // tab that goes away mid-wait does not get one last free request.
        if (document.visibilityState === 'visible') router.refresh()
        tick()
      }, wait)
    }

    const restart = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      tick()
    }

    const onVisibility = () => {
      // Returning to a stale page should not mean waiting out an interval to
      // find out it was stale.
      if (document.visibilityState === 'visible') router.refresh()
      restart()
    }

    tick()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', restart)
    window.addEventListener('blur', restart)

    return () => {
      stopped = true
      if (timer.current) clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', restart)
      window.removeEventListener('blur', restart)
    }
  }, [router])

  return null
}

/** Focused and in front of somebody. */
const ACTIVE_MS = 5_000

/** Open on another monitor, or behind something. */
const BACKGROUND_MS = 30_000
