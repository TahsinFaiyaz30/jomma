'use client'

import {
  AppBar,
  Band,
  Bird,
  Divider,
  PINK,
  px,
  Recipient,
  SearchField,
  SearchGlyph,
} from './bkash-chrome'
import { type GlyphName, PickerGlyph, ServiceGlyph, TabGlyph } from './bkash-icons'

/**
 * The bKash Send Money flow, redrawn as a guide.
 *
 * Laid out from the reference screenshots at their native 914px width and scaled
 * to the mock — see `px()` in ./bkash-chrome, so a measurement taken off a
 * screenshot can be used directly. Every value on screen comes from the live
 * intent: the store's receiving number, the store's amount, this order's
 * reference code.
 *
 * Four things are deliberately not reproduced, and all four are choices:
 *
 * - **The device status bar and the floating chat bubble.** Phone furniture, not
 *   bKash's, and a fake clock in a guide is noise.
 * - **Recent and All contacts on the picker.** That list is the buyer's own
 *   phonebook. Stand-ins would only invite tapping a row instead of typing the
 *   number that is actually needed.
 * - **The promo banner and Quick Features.** One is an advert with a photograph
 *   in it; the other is a strip of recently paid numbers.
 * - **A balance.** Jomma cannot know the buyer's balance, so New Balance reads
 *   as unknown rather than showing a number that would be a fabrication.
 *
 * The icons are drawn approximations, not bKash's artwork.
 *
 * The PIN screen is drawn because the buyer will see it, but it is a picture.
 * There is no input, nothing is captured, and no PIN is ever sent anywhere.
 */

function Highlight({ children, on }: { children: React.ReactNode; on: boolean }) {
  if (!on) return <>{children}</>
  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute animate-pulse"
        style={{ inset: -3, borderRadius: 10, boxShadow: `0 0 0 2px ${PINK}` }}
        aria-hidden="true"
      />
      {children}
    </div>
  )
}

/* ── Screen 1: home ───────────────────────────────────────────────────────── */

/** bKash tints each service glyph differently; these are the closest matches. */
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

export function HomeScreen({ buyerLabel }: { buyerLabel: string }) {
  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      {/* Pink hero. The real one carries a village-at-dusk illustration; this is
          the same silhouette reduced to shapes. */}
      <div className="relative shrink-0 overflow-hidden" style={{ height: px(310) }}>
        <div className="absolute inset-0" style={{ backgroundColor: PINK }} />
        <svg
          className="absolute inset-x-0 bottom-0"
          viewBox="0 0 914 190"
          preserveAspectRatio="none"
          style={{ height: px(150), opacity: 0.35 }}
          aria-hidden="true"
        >
          <path
            d="M0 190V120c60-14 90 10 140 4s70-40 130-30 90 46 150 40 96-52 164-40 130 56 190 46 140-30 140-30v80z"
            fill="#c1105e"
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
              backgroundColor: 'rgba(255,255,255,0.28)',
              border: '2px solid rgba(255,255,255,0.5)',
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ fontSize: px(38), color: '#fff', fontWeight: 500 }}>
              {buyerLabel}
            </p>
            <div
              className="inline-flex items-center"
              style={{
                gap: px(16),
                marginTop: px(12),
                backgroundColor: '#fff',
                borderRadius: px(30),
                padding: `${px(8)}px ${px(22)}px ${px(8)}px ${px(8)}px`,
              }}
            >
              <span
                className="flex items-center justify-center"
                style={{
                  width: px(42),
                  height: px(42),
                  borderRadius: px(10),
                  backgroundColor: PINK,
                  color: '#fff',
                  fontSize: px(26),
                  fontWeight: 700,
                }}
              >
                ৳
              </span>
              <span style={{ fontSize: px(30), color: '#333' }}>Tap for Balance</span>
            </div>
          </div>

          <div
            className="flex shrink-0 items-center justify-center"
            style={{ width: px(84), height: px(84), borderRadius: '50%', backgroundColor: '#fff' }}
          >
            <SearchGlyph size={px(42)} color="#333" />
          </div>
          <div
            className="flex shrink-0 items-center justify-center"
            style={{ width: px(84), height: px(84), borderRadius: '50%', backgroundColor: '#fff' }}
          >
            <Bird size={px(42)} color={PINK} />
          </div>
        </div>
      </div>

      {/* The white sheet that overlaps the hero. */}
      <div
        className="relative flex-1"
        style={{
          backgroundColor: '#fff',
          borderTopLeftRadius: px(28),
          borderTopRightRadius: px(28),
          marginTop: px(-4),
          paddingTop: px(50),
        }}
      >
        <div className="grid grid-cols-4" style={{ rowGap: px(97) }}>
          {SERVICES.map(({ label, tint, glyph }) => {
            const isSend = label === 'Send Money'
            return (
              <div key={label} className="flex flex-col items-center" style={{ gap: px(30) }}>
                <Highlight on={isSend}>
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
                <span
                  className="text-center"
                  style={{ fontSize: px(30), color: '#3f3f46', lineHeight: 1.15 }}
                >
                  {label}
                </span>
              </div>
            )
          })}
        </div>

        <div className="flex justify-center" style={{ marginTop: px(54) }}>
          <span
            className="inline-flex items-center"
            style={{
              gap: px(12),
              border: '1px solid #ededed',
              borderRadius: px(40),
              padding: `${px(16)}px ${px(38)}px`,
              fontSize: px(30),
              color: PINK,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            See More <span style={{ fontSize: px(24) }}>⌄</span>
          </span>
        </div>
      </div>

      <div
        className="flex shrink-0 items-start justify-around"
        style={{
          borderTop: '1px solid #eee',
          height: px(104),
          paddingTop: px(10),
          backgroundColor: '#fff',
        }}
      >
        {TABS.map(({ label, glyph }, index) => (
          <div key={label} className="flex flex-col items-center" style={{ gap: px(8) }}>
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
    </div>
  )
}

/* ── Screen 2: contact picker ─────────────────────────────────────────────── */

const PICKER_CARDS = [
  { label: 'Priyo Numbers (0)', glyph: 'priyo' as const },
  { label: 'Auto Pay', glyph: 'autopay' as const },
  { label: 'Group Send Money', glyph: 'group' as const },
]

export function PickerScreen({ msisdn }: { msisdn: string }) {
  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      <AppBar title="Send Money" />
      <Highlight on>
        <SearchField placeholder="Enter name or number" />
      </Highlight>
      <Band />

      <div className="grid grid-cols-3" style={{ gap: px(30), padding: `${px(28)}px ${px(36)}px` }}>
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
            <span style={{ fontSize: px(30), color: '#3f3f46', lineHeight: 1.25 }}>{label}</span>
          </div>
        ))}
      </div>

      <Band />

      {/*
        Recent and All contacts sit here in the real app. Not drawn: it is the
        buyer's own phonebook and has nothing to do with this payment.
      */}
      <div className="flex min-h-0 flex-1 items-center justify-center" style={{ padding: px(60) }}>
        <p style={{ fontSize: px(32), color: '#8b8b8b', textAlign: 'center', lineHeight: 1.5 }}>
          Type{' '}
          <span className="figure" style={{ color: '#111', fontWeight: 600 }}>
            {msisdn}
          </span>{' '}
          into the box above
        </p>
      </div>
    </div>
  )
}

/* ── Screen 3: number entered ─────────────────────────────────────────────── */

function SendMoneyTo({ msisdn }: { msisdn: string }) {
  return (
    <p style={{ fontSize: px(38), color: '#8b8b8b' }}>
      Send Money to{' '}
      <span className="figure" style={{ color: '#111', fontWeight: 600 }}>
        {msisdn}
      </span>
    </p>
  )
}

export function EnteredScreen({ msisdn }: { msisdn: string }) {
  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      <AppBar title="Send Money" />
      <SearchField value={msisdn} />
      <Band />

      <div className="flex flex-1 flex-col items-center" style={{ paddingTop: px(200) }}>
        <SendMoneyTo msisdn={msisdn} />
        <div style={{ marginTop: px(72) }}>
          <Highlight on>
            <button
              type="button"
              tabIndex={-1}
              style={{
                backgroundColor: PINK,
                color: '#fff',
                borderRadius: px(12),
                padding: `${px(30)}px ${px(48)}px`,
                fontSize: px(38),
              }}
            >
              Tap to continue
            </button>
          </Highlight>
        </div>
      </div>
    </div>
  )
}

/* ── Screen 4: confirm the number ─────────────────────────────────────────── */

export function ConfirmNumberScreen({ msisdn }: { msisdn: string }) {
  return (
    <div className="relative flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      {/* The screen underneath, still visible through the scrim. */}
      <AppBar title="Send Money" dimmed />
      <SearchField value={msisdn} />
      <Band />
      <div className="flex flex-1 flex-col items-center" style={{ paddingTop: px(200) }}>
        <SendMoneyTo msisdn={msisdn} />
        <div style={{ marginTop: px(72) }}>
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
        </div>
      </div>

      {/* bKash dims everything below the app bar, not the bar itself. */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ top: px(127), backgroundColor: 'rgba(60,60,60,0.62)' }}
      />

      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          backgroundColor: '#fff',
          borderTopLeftRadius: px(46),
          borderTopRightRadius: px(46),
        }}
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
      </div>
    </div>
  )
}

/* ── Screen 5: amount, reference, PIN ─────────────────────────────────────── */

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '↵']

export function AmountScreen({
  msisdn,
  amount,
  refCode,
  highlight,
}: {
  msisdn: string
  amount: string
  refCode: string
  highlight: 'amount' | 'reference' | 'pin'
}) {
  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: '#fff' }}>
      <AppBar title="Send Money" />

      <p style={{ fontSize: px(32), color: '#6b7280', padding: `${px(24)}px ${px(36)}px 0` }}>
        Recipient
      </p>
      <Recipient msisdn={msisdn} />
      <Band />

      <Highlight on={highlight === 'amount'}>
        <div className="grid grid-cols-3" style={{ padding: `${px(28)}px ${px(36)}px` }}>
          <div>
            <p style={{ fontSize: px(32), color: '#6b7280' }}>Amount</p>
            <p className="amount" style={{ fontSize: px(46), fontWeight: 600, color: '#111' }}>
              {amount}
            </p>
          </div>
          <div className="text-center">
            <p style={{ fontSize: px(32), color: '#6b7280' }}>Charge</p>
            {/*
              bKash's own fee, which comes off the sender — the store receives
              the full amount regardless. Shown the way the app shows it.
            */}
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

      <Highlight on={highlight === 'reference'}>
        <div style={{ padding: `${px(26)}px ${px(36)}px` }}>
          <div className="flex items-baseline justify-between">
            <p style={{ fontSize: px(32), color: '#6b7280' }}>Reference</p>
            <p style={{ fontSize: px(30), color: '#a1a1aa' }}>{refCode.length}/50</p>
          </div>
          <p
            className="figure"
            style={{ fontSize: px(40), color: '#111', marginTop: px(14), fontWeight: 600 }}
          >
            {refCode}
          </p>
        </div>
      </Highlight>
      <Band />

      <Highlight on={highlight === 'pin'}>
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
          <span style={{ fontSize: px(38), color: '#a1a1aa' }}>Enter PIN</span>
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
          backgroundColor: '#a0a0a0',
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

/* ── Screen 6: confirm and hold ───────────────────────────────────────────── */

export function ConfirmSendScreen({
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
          {/* Unknown by design. Jomma cannot see a buyer's balance, and drawing
              a number here would be inventing one. */}
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
        <div
          className="shrink-0"
          style={{
            width: px(56),
            height: px(56),
            borderRadius: px(10),
            border: `2px solid ${PINK}`,
          }}
        />
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
