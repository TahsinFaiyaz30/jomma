'use client'

import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { AppBar, Band, Bird, Divider, PINK, px, Recipient, SearchGlyph } from './bkash-chrome'
import { type GlyphName, PickerGlyph, ServiceGlyph, TabGlyph } from './bkash-icons'

/**
 * The bKash Send Money flow, redrawn as a guide.
 *
 * Four screens, not eight: tapping around inside one screen is not a page
 * change, and animating it as one is what made an earlier version feel like a
 * slideshow of screenshots rather than someone using an app. Steps 2–4 are all
 * the Send Money screen, and 5–7 are all the amount screen.
 *
 * Laid out from the reference screenshots at their native 914px width and
 * scaled uniformly — see `px()` in ./bkash-chrome, so a measurement taken off a
 * screenshot can be used directly in both axes. Every value on screen comes from
 * the live intent.
 *
 * What is deliberately not reproduced:
 *
 * - **The device status bar and the floating chat bubble.** Phone furniture, not
 *   bKash's.
 * - **Recent and All contacts, and the Quick Features numbers.** Those are the
 *   buyer's own phonebook and payment history.
 * - **The promo artwork.** Standing in as a grey skeleton so the page still has
 *   its real shape and still runs off the bottom edge the way it does in the app.
 * - **A balance.** Jomma cannot know a buyer's balance, so New Balance reads as
 *   unknown rather than showing a number that would be a fabrication.
 *
 * The icons are drawn approximations, not bKash's artwork.
 *
 * The PIN screen is drawn because the buyer will see it, but it is a picture.
 * There is no input, nothing is captured, and no PIN is ever sent anywhere.
 */

function Highlight({ children, on }: { children: React.ReactNode; on: boolean }) {
  return (
    <div className="relative">
      {on ? (
        <motion.span
          className="pointer-events-none absolute"
          style={{ inset: -3, borderRadius: 10 }}
          animate={{
            boxShadow: [`0 0 0 2px ${PINK}66`, `0 0 0 2px ${PINK}`, `0 0 0 2px ${PINK}66`],
          }}
          transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY }}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </div>
  )
}

/** Grey stand-in for artwork this guide has no business reproducing. */
function Skeleton({ h, r = 16, w }: { h: number; r?: number; w?: string }) {
  return (
    <div
      style={{
        height: px(h),
        width: w ?? '100%',
        borderRadius: px(r),
        backgroundColor: '#ededed',
      }}
    />
  )
}

/* ── Home ─────────────────────────────────────────────────────────────────── */

const SERVICES: Array<{ label: string; tint: string; glyph: GlyphName }> = [
  { label: 'Send Money', tint: '#e2136e', glyph: 'send' },
  { label: 'Mobile Recharge', tint: '#2e9e6b', glyph: 'recharge' },
  { label: 'Cash Out', tint: '#12a5a5', glyph: 'cashout' },
  { label: 'Payment', tint: '#e8862a', glyph: 'payment' },
  { label: 'Add Money', tint: '#7c5cc4', glyph: 'addmoney' },
  { label: 'Pay Bill', tint: '#8a9099', glyph: 'paybill' },
  { label: 'Savings', tint: '#d4408a', glyph: 'savings' },
  { label: 'Loan', tint: '#b8892e', glyph: 'loan' },
]

const TABS = [
  { label: 'Home', glyph: 'home' as const },
  { label: 'My bKash', glyph: 'wallet' as const },
  { label: 'Scan QR', glyph: 'qr' as const },
  { label: 'Inbox', glyph: 'inbox' as const },
]

function ServiceTile({
  label,
  tint,
  glyph,
  highlighted,
}: {
  label: string
  tint: string
  glyph: GlyphName
  highlighted: boolean
}) {
  return (
    <div className="flex flex-col items-center" style={{ gap: px(30) }}>
      <Highlight on={highlighted}>
        <div
          className="flex items-center justify-center"
          style={{
            width: px(110),
            height: px(110),
            borderRadius: '50%',
            backgroundColor: '#f6f6f7',
          }}
        >
          <ServiceGlyph name={glyph} size={px(56)} color={tint} />
        </div>
      </Highlight>
      <span className="text-center" style={{ fontSize: px(30), color: '#3f3f46', lineHeight: 1.2 }}>
        {label}
      </span>
    </div>
  )
}

export function HomePage({ buyerLabel }: { buyerLabel: string }) {
  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      {/* Hero. 95 → 405 in the reference, so 310 tall. */}
      <div className="relative shrink-0 overflow-hidden" style={{ height: px(310) }}>
        <div className="absolute inset-0" style={{ backgroundColor: PINK }} />
        <svg
          className="absolute inset-x-0 bottom-0"
          viewBox="0 0 914 150"
          preserveAspectRatio="none"
          style={{ height: px(150), opacity: 0.3 }}
          aria-hidden="true"
        >
          <path
            d="M0 150V96c58-13 88 9 137 4s69-38 128-29 88 44 147 39 94-50 161-39 128 55 187 45 154-28 154-28v62z"
            fill="#b60e57"
          />
        </svg>

        <div
          className="relative flex items-center"
          style={{ gap: px(20), padding: `${px(67)}px ${px(33)}px 0` }}
        >
          <div
            className="shrink-0"
            style={{
              width: px(100),
              height: px(100),
              borderRadius: '50%',
              backgroundColor: 'rgba(255,255,255,0.3)',
              border: '1.5px solid rgba(255,255,255,0.55)',
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ fontSize: px(40), color: '#fff', fontWeight: 500 }}>
              {buyerLabel}
            </p>
            {/* Pill: 286 x 50 in the reference, with a 36px rounded logo tile. */}
            <div
              className="inline-flex items-center"
              style={{
                gap: px(14),
                marginTop: px(14),
                height: px(50),
                backgroundColor: '#fff',
                borderRadius: px(25),
                padding: `0 ${px(24)}px 0 ${px(7)}px`,
              }}
            >
              <span
                className="flex items-center justify-center"
                style={{
                  width: px(36),
                  height: px(36),
                  borderRadius: px(9),
                  backgroundColor: PINK,
                  color: '#fff',
                  fontSize: px(24),
                  fontWeight: 700,
                }}
              >
                ৳
              </span>
              <span style={{ fontSize: px(30), color: '#2b2b2b' }}>Tap for Balance</span>
            </div>
          </div>

          <div
            className="flex shrink-0 items-center justify-center"
            style={{ width: px(84), height: px(84), borderRadius: '50%', backgroundColor: '#fff' }}
          >
            <SearchGlyph size={px(40)} color="#2b2b2b" />
          </div>
          <div
            className="flex shrink-0 items-center justify-center"
            style={{ width: px(84), height: px(84), borderRadius: '50%', backgroundColor: '#fff' }}
          >
            <Bird size={px(40)} color={PINK} />
          </div>
        </div>
      </div>

      {/*
        The white sheet. `overflow-hidden` matters: in the real app the content
        runs off the bottom edge, and a guide that neatly fits everything looks
        like a different screen.
      */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{
          backgroundColor: '#fff',
          borderTopLeftRadius: px(30),
          borderTopRightRadius: px(30),
          marginTop: px(-6),
          paddingTop: px(50),
        }}
      >
        <div className="grid grid-cols-4" style={{ rowGap: px(97) }}>
          {SERVICES.map(({ label, tint, glyph }) => (
            <ServiceTile
              key={label}
              label={label}
              tint={tint}
              glyph={glyph}
              highlighted={label === 'Send Money'}
            />
          ))}
        </div>

        {/* The third row, faded and half-hidden behind See More. */}
        <div
          className="grid grid-cols-4"
          style={{ marginTop: px(97), opacity: 0.22, filter: 'blur(1.4px)' }}
          aria-hidden="true"
        >
          {['#5aa9e6', '#e2136e', '#8a9099', '#7c5cc4'].map((tint) => (
            <div key={tint} className="flex justify-center">
              <div
                style={{
                  width: px(110),
                  height: px(110),
                  borderRadius: '50%',
                  backgroundColor: '#f6f6f7',
                  border: `2px solid ${tint}33`,
                }}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-center" style={{ marginTop: px(-58) }}>
          <span
            className="inline-flex items-center bg-white"
            style={{
              gap: px(12),
              border: '1px solid #ececec',
              borderRadius: px(40),
              padding: `${px(14)}px ${px(34)}px`,
              fontSize: px(30),
              color: PINK,
              boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
            }}
          >
            See More <span style={{ fontSize: px(24) }}>⌄</span>
          </span>
        </div>

        {/* Promo. Real artwork replaced with a skeleton. */}
        <div style={{ padding: `${px(60)}px ${px(36)}px 0` }}>
          <Skeleton h={265} />
        </div>

        {/* Quick Features, minus the numbers — they are the buyer's history.
            Left as skeletons so the page still runs off the bottom edge. */}
        <div style={{ padding: `${px(46)}px ${px(36)}px 0` }}>
          <Skeleton h={34} r={8} w="38%" />
          <div className="grid grid-cols-3" style={{ gap: px(28), marginTop: px(30) }}>
            <Skeleton h={130} />
            <Skeleton h={130} />
            <Skeleton h={130} />
          </div>
          <div className="grid grid-cols-3" style={{ gap: px(28), marginTop: px(28) }}>
            <Skeleton h={160} />
            <Skeleton h={160} />
            <Skeleton h={160} />
          </div>
        </div>
      </div>

      {/* Tab bar: 1855 → 1940 in the reference, so 85 tall. */}
      <div
        className="flex shrink-0 items-start justify-around"
        style={{
          borderTop: '1px solid #ededed',
          height: px(85),
          paddingTop: px(6),
          backgroundColor: '#fff',
        }}
      >
        {TABS.map(({ label, glyph }, index) => (
          <div key={label} className="flex flex-col items-center" style={{ gap: px(6) }}>
            <TabGlyph
              name={glyph}
              size={px(46)}
              color={index === 0 ? PINK : '#5f6368'}
              filled={index === 0}
            />
            <span
              style={{ fontSize: px(28), lineHeight: 1, color: index === 0 ? PINK : '#5f6368' }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* The gesture strip below the tab bar, 1940 → 1980 in the reference.
          Without it the labels sit in the frame's rounded corner and clip. */}
      <div
        className="flex shrink-0 items-center justify-center"
        style={{ height: px(40), backgroundColor: '#fff' }}
      >
        <div
          style={{
            width: px(300),
            height: px(6),
            borderRadius: px(3),
            backgroundColor: '#d4d4d8',
          }}
        />
      </div>
    </div>
  )
}

/* ── Send Money ───────────────────────────────────────────────────────────── */

export type SendPhase = 'empty' | 'typed' | 'sheet'

/** Reveals the number a character at a time, so step 2 → 3 reads as typing. */
function useTypedValue(target: string, active: boolean): string {
  const [count, setCount] = useState(active ? target.length : 0)

  useEffect(() => {
    if (!active) {
      setCount(0)
      return
    }
    setCount(0)
    const timer = setInterval(() => {
      setCount((current) => {
        if (current >= target.length) {
          clearInterval(timer)
          return current
        }
        return current + 1
      })
    }, 55)
    return () => clearInterval(timer)
  }, [active, target])

  return target.slice(0, count)
}

const PICKER_CARDS = [
  { label: 'Priyo Numbers (0)', glyph: 'priyo' as const },
  { label: 'Auto Pay', glyph: 'autopay' as const },
  { label: 'Group Send Money', glyph: 'group' as const },
]

export function SendMoneyPage({ msisdn, phase }: { msisdn: string; phase: SendPhase }) {
  const dimmed = phase === 'sheet'
  const typed = useTypedValue(msisdn, phase !== 'empty')
  const showResult = phase !== 'empty'

  return (
    <div className="relative flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      <AppBar title="Send Money" dimmed={dimmed} />

      {/* One search field for the whole page — it fills in rather than the page
          being replaced, which is what actually happens. */}
      <Highlight on={phase === 'empty'}>
        <div style={{ padding: `${px(34)}px ${px(36)}px` }}>
          <div
            className="flex items-center"
            style={{
              height: px(97),
              gap: px(28),
              paddingLeft: px(28),
              borderRadius: px(14),
              backgroundColor: '#f7f7f7',
              border: '1px solid #ececec',
            }}
          >
            <SearchGlyph size={px(44)} color="#9a9a9a" />
            {typed ? (
              <span className="figure" style={{ fontSize: px(34), color: '#1f2937' }}>
                {typed}
              </span>
            ) : (
              <span style={{ fontSize: px(34), color: '#a9a9a9' }}>Enter name or number</span>
            )}
          </div>
        </div>
      </Highlight>
      <Band />

      {showResult ? (
        <motion.div
          className="flex flex-1 flex-col items-center"
          style={{ paddingTop: px(200) }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <p style={{ fontSize: px(38), color: '#8b8b8b' }}>
            Send Money to{' '}
            <span className="figure" style={{ color: '#111', fontWeight: 600 }}>
              {msisdn}
            </span>
          </p>
          <div style={{ marginTop: px(72) }}>
            <Highlight on={phase === 'typed'}>
              <span
                style={{
                  display: 'inline-block',
                  backgroundColor: PINK,
                  color: '#fff',
                  borderRadius: px(12),
                  padding: `${px(30)}px ${px(48)}px`,
                  fontSize: px(38),
                }}
              >
                Tap to continue
              </span>
            </Highlight>
          </div>
        </motion.div>
      ) : (
        <>
          <div
            className="grid grid-cols-3"
            style={{ gap: px(30), padding: `${px(28)}px ${px(36)}px` }}
          >
            {PICKER_CARDS.map(({ label, glyph }) => (
              <div
                key={label}
                className="flex flex-col"
                style={{
                  gap: px(24),
                  border: '1px solid #ececec',
                  borderRadius: px(16),
                  padding: `${px(28)}px ${px(24)}px`,
                  minHeight: px(217),
                }}
              >
                <PickerGlyph name={glyph} size={px(66)} color={PINK} />
                <span style={{ fontSize: px(30), color: '#3f3f46', lineHeight: 1.25 }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
          <Band />
          <div
            className="flex min-h-0 flex-1 items-center justify-center"
            style={{ padding: px(60) }}
          >
            <p style={{ fontSize: px(32), color: '#8b8b8b', textAlign: 'center', lineHeight: 1.5 }}>
              Type{' '}
              <span className="figure" style={{ color: '#111', fontWeight: 600 }}>
                {msisdn}
              </span>{' '}
              into the box above
            </p>
          </div>
        </>
      )}

      {/* The scrim and sheet, which slide in over this same page. */}
      {dimmed ? (
        <motion.div
          className="absolute inset-x-0 bottom-0"
          style={{ top: px(127), backgroundColor: 'rgba(60,60,60,0.62)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22 }}
        />
      ) : null}

      {dimmed ? (
        <motion.div
          className="absolute inset-x-0 bottom-0"
          style={{
            backgroundColor: '#fff',
            borderTopLeftRadius: px(46),
            borderTopRightRadius: px(46),
          }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        >
          <div style={{ padding: `${px(44)}px ${px(36)}px ${px(36)}px` }}>
            <p style={{ fontSize: px(32), color: '#8b8b8b' }}>Before you proceed:</p>
            <p className="figure" style={{ fontSize: px(52), color: '#111', marginTop: px(20) }}>
              {msisdn} <span style={{ fontSize: px(34), color: PINK, fontWeight: 500 }}>Edit</span>
            </p>
            <p style={{ fontSize: px(32), color: '#4b5563', marginTop: px(14) }}>
              Please check if the number is correct.
            </p>
          </div>
          <Highlight on>
            <div
              className="flex items-center justify-between"
              style={{
                backgroundColor: PINK,
                color: '#fff',
                padding: `${px(34)}px ${px(36)}px`,
                fontSize: px(38),
                fontWeight: 600,
              }}
            >
              <span>Yes, the number is correct</span>
              <span style={{ fontSize: px(44) }} aria-hidden="true">
                →
              </span>
            </div>
          </Highlight>
        </motion.div>
      ) : null}
    </div>
  )
}

/* ── Amount, reference, PIN ───────────────────────────────────────────────── */

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '↵']

export type AmountFocus = 'amount' | 'reference' | 'pin'

export function AmountPage({
  msisdn,
  amount,
  refCode,
  focus,
}: {
  msisdn: string
  amount: string
  refCode: string
  focus: AmountFocus
}) {
  // The reference is typed in on its own step, not present from the start.
  const typedRef = useTypedValue(refCode, focus !== 'amount')

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      <AppBar title="Send Money" />

      <p style={{ fontSize: px(32), color: '#6b7280', padding: `${px(24)}px ${px(36)}px 0` }}>
        Recipient
      </p>
      <Recipient msisdn={msisdn} />
      <Band />

      <Highlight on={focus === 'amount'}>
        <div className="grid grid-cols-3" style={{ padding: `${px(28)}px ${px(36)}px` }}>
          <div>
            <p style={{ fontSize: px(32), color: '#6b7280' }}>Amount</p>
            <p className="amount" style={{ fontSize: px(46), fontWeight: 600, color: '#111' }}>
              {amount}
            </p>
          </div>
          <div className="text-center">
            <p style={{ fontSize: px(32), color: '#6b7280' }}>Charge</p>
            {/* bKash's own fee, taken from the sender — the store receives the
                full amount regardless. Shown the way the app shows it. */}
            <p className="amount" style={{ fontSize: px(46), color: '#b0b0b0' }}>
              + ৳0.00
            </p>
          </div>
          <div className="text-right">
            <p style={{ fontSize: px(32), color: '#6b7280' }}>Total</p>
            <p className="amount" style={{ fontSize: px(46), fontWeight: 600, color: '#111' }}>
              {amount}
            </p>
          </div>
        </div>
      </Highlight>
      <Band />

      <Highlight on={focus === 'reference'}>
        <div style={{ padding: `${px(26)}px ${px(36)}px` }}>
          <div className="flex items-baseline justify-between">
            <p style={{ fontSize: px(32), color: '#6b7280' }}>Reference</p>
            <p style={{ fontSize: px(30), color: '#a1a1aa' }}>{typedRef.length}/50</p>
          </div>
          {typedRef ? (
            <p
              className="figure"
              style={{ fontSize: px(40), color: '#111', marginTop: px(14), fontWeight: 600 }}
            >
              {typedRef}
            </p>
          ) : (
            <p style={{ fontSize: px(38), color: '#a9a9a9', marginTop: px(14) }}>
              Tap to add a note
            </p>
          )}
        </div>
      </Highlight>
      <Band />

      <Highlight on={focus === 'pin'}>
        <div
          className="flex items-center justify-between"
          style={{ padding: `${px(30)}px ${px(36)}px` }}
        >
          <svg
            viewBox="0 0 24 24"
            style={{ width: px(46), height: px(46) }}
            fill="none"
            aria-hidden="true"
          >
            <rect x="4" y="10" width="16" height="11" rx="2.5" fill={PINK} />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke={PINK} strokeWidth="2.2" />
          </svg>
          {focus === 'pin' ? (
            <span className="figure" style={{ fontSize: px(44), color: '#111', letterSpacing: 4 }}>
              ••••
            </span>
          ) : (
            <span style={{ fontSize: px(38), color: '#a1a1aa' }}>Enter PIN</span>
          )}
          <svg
            viewBox="0 0 24 24"
            style={{ width: px(52), height: px(52) }}
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"
              stroke={PINK}
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M9 16c0-3 1-5 3-5s3 2 3 5M12 8.5c2.5 0 4 2 4 5"
              stroke={PINK}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </Highlight>

      <div className="flex-1" />

      <div
        className="flex items-center justify-between"
        style={{
          backgroundColor: focus === 'pin' ? PINK : '#a0a0a0',
          color: '#fff',
          padding: `${px(26)}px ${px(36)}px`,
          fontSize: px(36),
        }}
      >
        <span>Confirm PIN</span>
        <span style={{ fontSize: px(44) }} aria-hidden="true">
          →
        </span>
      </div>

      <div
        className="grid grid-cols-3"
        style={{ backgroundColor: '#e9eef0', paddingTop: px(10), paddingBottom: px(10) }}
      >
        {KEYPAD.map((key) => {
          const isAction = key === '⌫' || key === '↵'
          return (
            <div key={key} className="flex items-center justify-center" style={{ height: px(128) }}>
              {isAction ? (
                <span
                  className="flex items-center justify-center"
                  style={{
                    width: px(110),
                    height: px(76),
                    borderRadius: key === '↵' ? '50%' : px(16),
                    backgroundColor: '#9aa0a6',
                    color: '#fff',
                    fontSize: px(40),
                  }}
                >
                  {key}
                </span>
              ) : (
                <span style={{ fontSize: px(62), color: '#6b7280', fontWeight: 300 }}>{key}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Confirm and hold ─────────────────────────────────────────────────────── */

export function ConfirmPage({
  msisdn,
  amount,
  refCode,
}: {
  msisdn: string
  amount: string
  refCode: string
}) {
  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      <div
        className="flex items-center justify-between"
        style={{ padding: `${px(120)}px ${px(36)}px ${px(40)}px` }}
      >
        <p style={{ fontSize: px(42), color: PINK }}>
          Confirm to <strong style={{ fontWeight: 700 }}>Send Money</strong>
        </p>
        <span style={{ fontSize: px(48), color: '#e63946' }} aria-hidden="true">
          ✕
        </span>
      </div>

      <Recipient msisdn={msisdn} />
      <Divider />

      <div className="grid grid-cols-2">
        <div style={{ padding: `${px(26)}px ${px(36)}px`, borderRight: '1px solid #ededed' }}>
          <p style={{ fontSize: px(32), color: '#6b7280' }}>Total</p>
          <p className="amount" style={{ fontSize: px(46), fontWeight: 600, color: '#111' }}>
            {amount}
          </p>
          <p style={{ fontSize: px(32), color: '#a1a1aa' }}>+ No charge</p>
        </div>
        <div style={{ padding: `${px(26)}px ${px(36)}px` }}>
          <p style={{ fontSize: px(32), color: '#6b7280' }}>New Balance</p>
          {/* Unknown by design. Jomma cannot see a buyer's balance, and a number
              here would be invented. */}
          <p style={{ fontSize: px(46), color: '#d4d4d8' }}>—</p>
        </div>
      </div>
      <Divider />

      <div className="grid grid-cols-2">
        <div style={{ padding: `${px(26)}px ${px(36)}px`, borderRight: '1px solid #ededed' }}>
          <p style={{ fontSize: px(32), color: '#6b7280' }}>Reference</p>
          <p
            className="figure"
            style={{ fontSize: px(40), fontWeight: 600, color: '#111', marginTop: px(8) }}
          >
            {refCode}
          </p>
        </div>
        <div />
      </div>
      <Divider />

      <div className="flex items-start" style={{ gap: px(24), padding: `${px(30)}px ${px(36)}px` }}>
        <PickerGlyph name="priyo" size={px(56)} color={PINK} />
        <p style={{ fontSize: px(32), color: '#4b5563', lineHeight: 1.4 }}>
          You can send money free up to 25,000 Tk. monthly by adding Priyo number.
        </p>
      </div>

      <div className="flex-1" />

      <Highlight on>
        <div
          className="relative flex flex-col items-center justify-end"
          style={{
            backgroundColor: PINK,
            height: px(300),
            borderTopLeftRadius: '50% 100%',
            borderTopRightRadius: '50% 100%',
            paddingBottom: px(60),
            gap: px(20),
          }}
        >
          <Bird size={px(80)} />
          <span style={{ color: '#fff', fontSize: px(38) }}>Tap and hold for Send Money</span>
        </div>
      </Highlight>
    </div>
  )
}
