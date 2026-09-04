'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AmountFocus,
  AmountPage,
  ConfirmPage,
  HomePage,
  SendMoneyPage,
  type SendPhase,
} from './bkash-screens'

/**
 * The animated walkthrough.
 *
 * It plays by itself, because the buyer is holding a phone in the other hand and
 * should not have to drive a slideshow to find out what to type.
 *
 * The load-bearing detail is which steps animate. Eight steps sit on only four
 * *pages*, and only a real navigation gets a page transition — tapping around
 * inside one screen must not slide, or the whole thing reads as a stack of
 * screenshots rather than someone using an app:
 *
 *   home                    step 1
 *   send money    push      steps 2-4   number types itself, then a sheet rises
 *   amount/PIN    push      steps 5-7   focus moves; nothing else changes
 *   confirm       push      step 8
 *
 * `AnimatePresence` is therefore keyed on the page, not the step. Within a page
 * React keeps the same element mounted and only updates props, so the search
 * field fills in and the sheet slides up over a screen that never went away.
 */

export interface GuideData {
  msisdn: string
  amount: string
  refCode: string
  /** The buyer's own name or number, shown where bKash shows theirs. */
  buyerLabel: string
}

type PageId = 'home' | 'send' | 'amount' | 'confirm'

interface Step {
  id: string
  page: PageId
  label: string
  caption: React.ReactNode
  /** How long this step holds before advancing, ms. */
  hold: number
  /**
   * Where to tap, as a percentage of the phone screen.
   *
   * Declared per step rather than measured off the DOM: the pointer has to glide
   * between two screens that are mid-transition, so it cannot ask either of them
   * where anything is. Percentages also survive the frame being resized.
   */
  tap: { x: number; y: number; press?: boolean }
  phase?: SendPhase
  focus?: AmountFocus
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="figure rounded bg-muted px-1 py-0.5 font-semibold">{children}</span>
}

function buildSteps(data: GuideData): Step[] {
  return [
    {
      id: 'home',
      page: 'home',
      label: 'Open bKash',
      caption: (
        <>
          Open bKash and tap <strong>Send Money</strong>.
        </>
      ),
      hold: 3000,
      tap: { x: 13, y: 22 },
    },
    {
      id: 'search',
      page: 'send',
      phase: 'empty',
      label: 'Type the number',
      caption: (
        <>
          Tap the search box and type <Value>{data.msisdn}</Value>. Do not pick a saved contact.
        </>
      ),
      hold: 4000,
      tap: { x: 50, y: 11 },
    },
    {
      id: 'typed',
      page: 'send',
      phase: 'typed',
      label: 'Continue',
      caption: (
        <>
          Check it reads <Value>{data.msisdn}</Value>, then tap <strong>Tap to continue</strong>.
        </>
      ),
      hold: 3600,
      tap: { x: 50, y: 34 },
    },
    {
      id: 'sheet',
      page: 'send',
      phase: 'sheet',
      label: 'Confirm number',
      caption: (
        <>
          bKash asks you to check the number. Tap <strong>Yes, the number is correct</strong>.
        </>
      ),
      hold: 3600,
      tap: { x: 50, y: 96 },
    },
    {
      id: 'amount',
      page: 'amount',
      focus: 'amount',
      label: 'Enter amount',
      caption: (
        <>
          Enter exactly <Value>{data.amount}</Value>. A different amount will not match this order.
        </>
      ),
      hold: 4200,
      tap: { x: 18, y: 25 },
    },
    {
      id: 'reference',
      page: 'amount',
      focus: 'reference',
      label: 'Add reference',
      caption: (
        <>
          Tap <strong>Reference</strong> and type <Value>{data.refCode}</Value>. This is what tells
          us the payment is yours.
        </>
      ),
      hold: 4600,
      tap: { x: 30, y: 35 },
    },
    {
      id: 'pin',
      page: 'amount',
      focus: 'pin',
      label: 'Enter PIN',
      caption: (
        <>
          Enter your own bKash PIN. <strong>Never type it anywhere but the bKash app</strong> — this
          page will never ask for it.
        </>
      ),
      hold: 4200,
      tap: { x: 50, y: 41 },
    },
    {
      id: 'hold',
      page: 'confirm',
      label: 'Tap and hold',
      caption: (
        <>
          Press and <strong>hold</strong> the pink bar until it completes. That is the last step.
        </>
      ),
      hold: 4400,
      tap: { x: 50, y: 96, press: true },
    },
  ]
}

/**
 * The hand.
 *
 * Lives outside the page transition so it survives a step change and glides to
 * the next target instead of blinking there. Translucent on purpose: a solid dot
 * hides the control it is pointing at. `press` stretches the ripple into a long
 * hold for the last step, which is the one people get wrong.
 */
function TapPointer({
  target,
  reduceMotion,
}: {
  target: { x: number; y: number; press?: boolean }
  reduceMotion: boolean | null
}) {
  const press = target.press === true
  const duration = press ? 1.8 : 1.3

  return (
    <motion.div
      className="pointer-events-none absolute z-10"
      animate={{ left: `${target.x}%`, top: `${target.y}%` }}
      transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      style={{ translateX: '-50%', translateY: '-50%' }}
      aria-hidden="true"
    >
      <div className="relative flex items-center justify-center">
        <motion.span
          className="absolute rounded-full"
          style={{ backgroundColor: 'rgba(226,19,110,0.26)' }}
          initial={{ width: 20, height: 20, opacity: 0 }}
          animate={
            reduceMotion
              ? { width: 34, height: 34, opacity: 0.5 }
              : { width: [20, 54, 54], height: [20, 54, 54], opacity: [0.6, 0, 0] }
          }
          transition={
            reduceMotion
              ? undefined
              : { duration, repeat: Number.POSITIVE_INFINITY, ease: 'easeOut' }
          }
        />
        <motion.span
          className="block rounded-full"
          style={{
            // A ring, not a disc. Any fill at all — even a translucent one —
            // sits on top of the control the pointer exists to point at.
            backgroundColor: 'transparent',
            border: '2.5px solid rgba(226,19,110,0.95)',
            boxShadow: '0 0 0 1.5px rgba(255,255,255,0.9), inset 0 0 0 1.5px rgba(255,255,255,0.9)',
          }}
          initial={{ width: 26, height: 26 }}
          animate={
            reduceMotion ? { width: 26, height: 26 } : { width: [26, 19, 26], height: [26, 19, 26] }
          }
          transition={
            reduceMotion
              ? undefined
              : { duration, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
          }
        />
      </div>
    </motion.div>
  )
}

function renderPage(step: Step, data: GuideData) {
  switch (step.page) {
    case 'home':
      return <HomePage buyerLabel={data.buyerLabel} />
    case 'send':
      return <SendMoneyPage msisdn={data.msisdn} phase={step.phase ?? 'empty'} />
    case 'amount':
      return (
        <AmountPage
          msisdn={data.msisdn}
          amount={data.amount}
          refCode={data.refCode}
          focus={step.focus ?? 'amount'}
        />
      )
    case 'confirm':
      return <ConfirmPage msisdn={data.msisdn} amount={data.amount} refCode={data.refCode} />
    default:
      return null
  }
}

export function BkashGuide({ data }: { data: GuideData }) {
  const steps = buildSteps(data)
  const reduceMotion = useReducedMotion()

  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  // Which way the next page should slide in. Set before the index changes so the
  // transition is already pointing the right way when it runs.
  const direction = useRef(1)

  const step = steps[index] as Step

  const go = useCallback(
    (next: number) => {
      const wrapped = ((next % steps.length) + steps.length) % steps.length
      setIndex((current) => {
        direction.current =
          wrapped === 0 && current === steps.length - 1 ? 1 : wrapped > current ? 1 : -1
        return wrapped
      })
    },
    [steps.length],
  )

  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => go(index + 1), step.hold)
    return () => clearTimeout(timer)
  }, [playing, index, step.hold, go])

  const enter = direction.current > 0 ? '100%' : '-40%'
  const leave = direction.current > 0 ? '-40%' : '100%'

  return (
    <div className="flex flex-col items-center gap-4">
      {/* The phone. No status bar and no floating chat bubble — those are the
          device's furniture, not bKash's. */}
      <div className="relative w-[280px] shrink-0 overflow-hidden rounded-[26px] border-[7px] border-neutral-900 bg-white shadow-xl">
        <div className="relative h-[577px] overflow-hidden">
          <AnimatePresence initial={false} mode="sync">
            <motion.div
              key={step.page}
              className="absolute inset-0"
              initial={reduceMotion ? { opacity: 0 } : { x: enter }}
              animate={{ x: 0, opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { x: leave, opacity: 0.6 }}
              transition={
                reduceMotion
                  ? { duration: 0.2 }
                  : { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }
              }
            >
              {renderPage(step, data)}
            </motion.div>
          </AnimatePresence>

          <TapPointer target={step.tap} reduceMotion={reduceMotion} />
        </div>

        <div className="absolute inset-x-0 bottom-0 h-1 bg-neutral-200">
          <motion.div
            className="h-full bg-neutral-800"
            animate={{ width: `${((index + 1) / steps.length) * 100}%` }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        </div>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <p aria-live="polite" className="min-h-10 text-center text-small leading-relaxed">
          <span className="mr-1.5 text-muted-foreground">
            {index + 1}/{steps.length}
          </span>
          {step.caption}
        </p>

        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setPlaying(false)
              go(index - 1)
            }}
            className="rounded px-2 py-1 text-micro text-muted-foreground hover:text-foreground"
          >
            Back
          </button>

          {steps.map((candidate, position) => (
            <button
              key={candidate.id}
              type="button"
              aria-label={candidate.label}
              aria-current={position === index}
              onClick={() => {
                setPlaying(false)
                go(position)
              }}
              className="p-1"
            >
              <span
                className={`block size-1.5 rounded-full transition-colors ${
                  position === index ? 'bg-foreground' : 'bg-border'
                }`}
              />
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              setPlaying(false)
              go(index + 1)
            }}
            className="rounded px-2 py-1 text-micro text-muted-foreground hover:text-foreground"
          >
            Next
          </button>
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            className="text-micro text-muted-foreground underline-offset-2 hover:underline"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
      </div>
    </div>
  )
}
