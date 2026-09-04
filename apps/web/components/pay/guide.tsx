'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import {
  AmountScreen,
  ConfirmNumberScreen,
  ConfirmSendScreen,
  EnteredScreen,
  HomeScreen,
  PickerScreen,
} from './bkash-screens'

/**
 * The animated walkthrough.
 *
 * It plays by itself, because the buyer is holding a phone in the other hand and
 * should not have to drive a slideshow to find out what to type. It loops, so
 * somebody who looked away gets the step again without hunting for a back
 * button, and every step can still be reached by hand.
 *
 * The caption under the phone is the part that actually matters — the mock is
 * recognition, the caption is the instruction. Both come from the same step.
 */

export interface GuideData {
  msisdn: string
  amount: string
  refCode: string
  /** The buyer's own name or number, shown where bKash shows theirs. */
  buyerLabel: string
}

interface Step {
  id: string
  /** Short label for the step dots and the screen-reader list. */
  label: string
  caption: React.ReactNode
  /** How long this step holds before advancing, ms. */
  hold: number
  /**
   * Where to tap, as a percentage of the phone screen.
   *
   * Declared per step rather than measured off the DOM: the pointer has to glide
   * between two screens that are mid-crossfade, so it cannot ask either of them
   * where anything is. Percentages also survive the frame being resized.
   */
  tap: { x: number; y: number; press?: boolean }
  render: (data: GuideData) => React.ReactNode
}

function buildSteps(data: GuideData): Step[] {
  return [
    {
      id: 'home',
      label: 'Open bKash',
      caption: (
        <>
          Open bKash and tap <strong>Send Money</strong>.
        </>
      ),
      hold: 3200,
      tap: { x: 13, y: 22 },
      render: (d) => <HomeScreen buyerLabel={d.buyerLabel} />,
    },
    {
      id: 'picker',
      label: 'Type the number',
      caption: (
        <>
          Type <Value>{data.msisdn}</Value> into the search box. Do not pick a saved contact.
        </>
      ),
      hold: 4200,
      tap: { x: 50, y: 11 },
      render: (d) => <PickerScreen msisdn={d.msisdn} />,
    },
    {
      id: 'entered',
      label: 'Continue',
      caption: (
        <>
          Check the number reads <Value>{data.msisdn}</Value>, then tap{' '}
          <strong>Tap to continue</strong>.
        </>
      ),
      hold: 3600,
      tap: { x: 50, y: 34 },
      render: (d) => <EnteredScreen msisdn={d.msisdn} />,
    },
    {
      id: 'confirm-number',
      label: 'Confirm number',
      caption: (
        <>
          bKash asks you to check the number. Tap <strong>Yes, the number is correct</strong>.
        </>
      ),
      hold: 3600,
      tap: { x: 50, y: 96 },
      render: (d) => <ConfirmNumberScreen msisdn={d.msisdn} />,
    },
    {
      id: 'amount',
      label: 'Enter amount',
      caption: (
        <>
          Enter exactly <Value>{data.amount}</Value>. A different amount will not match this order.
        </>
      ),
      hold: 4200,
      tap: { x: 18, y: 25 },
      render: (d) => (
        <AmountScreen msisdn={d.msisdn} amount={d.amount} refCode={d.refCode} highlight="amount" />
      ),
    },
    {
      id: 'reference',
      label: 'Add reference',
      caption: (
        <>
          Tap <strong>Reference</strong> and type <Value>{data.refCode}</Value>. This is what tells
          us the payment is yours.
        </>
      ),
      hold: 4600,
      tap: { x: 30, y: 35 },
      render: (d) => (
        <AmountScreen
          msisdn={d.msisdn}
          amount={d.amount}
          refCode={d.refCode}
          highlight="reference"
        />
      ),
    },
    {
      id: 'pin',
      label: 'Enter PIN',
      caption: (
        <>
          Enter your own bKash PIN. <strong>Never type it anywhere but the bKash app</strong> — this
          page will never ask for it.
        </>
      ),
      hold: 4200,
      tap: { x: 50, y: 41 },
      render: (d) => (
        <AmountScreen msisdn={d.msisdn} amount={d.amount} refCode={d.refCode} highlight="pin" />
      ),
    },
    {
      id: 'hold',
      label: 'Tap and hold',
      caption: (
        <>
          Press and <strong>hold</strong> the pink bar until it completes. That is the last step.
        </>
      ),
      hold: 4200,
      tap: { x: 50, y: 96, press: true },
      render: (d) => <ConfirmSendScreen msisdn={d.msisdn} amount={d.amount} refCode={d.refCode} />,
    },
  ]
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="figure rounded bg-muted px-1 py-0.5 font-semibold">{children}</span>
}

/**
 * The hand.
 *
 * Lives outside the screen crossfade so it survives a step change and glides to
 * the next target instead of blinking there — the movement is what tells the
 * buyer the guide advanced and where their attention should go next. The ripple
 * loops on the spot so a step that is being read for a while still reads as
 * "tap this", and `press` stretches it into a long hold for the last step, which
 * is the one people get wrong.
 */
function TapPointer({
  target,
  reduceMotion,
}: {
  target: { x: number; y: number; press?: boolean }
  reduceMotion: boolean | null
}) {
  const press = target.press === true

  return (
    <motion.div
      className="pointer-events-none absolute z-10"
      animate={{ left: `${target.x}%`, top: `${target.y}%` }}
      transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      style={{ translateX: '-50%', translateY: '-50%' }}
      aria-hidden="true"
    >
      <div className="relative flex items-center justify-center">
        {/* Ripple. */}
        <motion.span
          className="absolute rounded-full"
          style={{ backgroundColor: 'rgba(226,19,110,0.28)' }}
          initial={{ width: 20, height: 20, opacity: 0 }}
          animate={
            reduceMotion
              ? { width: 34, height: 34, opacity: 0.5 }
              : { width: [20, 52, 52], height: [20, 52, 52], opacity: [0.65, 0, 0] }
          }
          transition={
            reduceMotion
              ? undefined
              : { duration: press ? 1.8 : 1.3, repeat: Number.POSITIVE_INFINITY, ease: 'easeOut' }
          }
        />
        {/* The fingertip. */}
        <motion.span
          className="block rounded-full border-2 shadow-md"
          style={{
            // Translucent on purpose: the pointer must not hide the control it
            // is pointing at.
            backgroundColor: 'rgba(226,19,110,0.30)',
            borderColor: 'rgba(255,255,255,0.95)',
            boxShadow: '0 0 0 1.5px rgba(226,19,110,0.85)',
          }}
          initial={{ width: 22, height: 22 }}
          animate={
            reduceMotion ? { width: 22, height: 22 } : { width: [22, 17, 22], height: [22, 17, 22] }
          }
          transition={
            reduceMotion
              ? undefined
              : { duration: press ? 1.8 : 1.3, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }
          }
        />
      </div>
    </motion.div>
  )
}

export function BkashGuide({ data }: { data: GuideData }) {
  const steps = buildSteps(data)
  const reduceMotion = useReducedMotion()

  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)

  const step = steps[index] as Step

  const go = useCallback(
    (next: number) => {
      setIndex(((next % steps.length) + steps.length) % steps.length)
    },
    [steps.length],
  )

  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => go(index + 1), step.hold)
    return () => clearTimeout(timer)
  }, [playing, index, step.hold, go])

  return (
    <div className="flex flex-col items-center gap-4">
      {/*
        The phone frame. No status bar and no floating chat bubble — those are
        the phone's furniture, not bKash's, and a fake clock in a guide is noise.
      */}
      <div className="relative w-[280px] shrink-0 overflow-hidden rounded-[22px] border-[6px] border-neutral-900 bg-white shadow-xl">
        <div className="relative h-[577px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step.id}
              className="absolute inset-0"
              initial={reduceMotion ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            >
              {step.render(data)}
            </motion.div>
          </AnimatePresence>

          <TapPointer target={step.tap} reduceMotion={reduceMotion} />
        </div>

        {/* Progress across the whole walkthrough, not just this step. */}
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
