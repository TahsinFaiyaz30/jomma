'use client'

/**
 * The `*247#` walkthrough screens.
 *
 * A different surface from the app guide, and deliberately so: none of this is
 * bKash's UI. It is the phone's dialler and the operator's USSD dialogs, which
 * is why it is dark and plain where the app screens are pink and rounded. A
 * buyer who has dialled a USSD code before will recognise it immediately, and
 * one who has not needs to see that it looks nothing like an app.
 *
 * Two things from the reference screenshots are deliberately dropped:
 *
 *  - The carrier line on each dialog ("1 Grameenphone Message"). It is the
 *    buyer's own SIM and operator, not something the guide can know or should
 *    claim — showing a network they are not on would be worse than showing none.
 *  - The keyboard. It is half the screen, it is the buyer's own, and it hides
 *    the prompt that actually matters. The typed value is highlighted on the
 *    input line instead, which is the part they need to copy.
 *
 * Sizes come off the reference screenshots at their native 540px width, scaled
 * to the 280px mock by `ux()` — the same trick bkash-chrome.tsx uses at 914.
 */

/** Reference screenshots are 540 CSS px wide; the mock is 280. */
const USSD_SCALE = 280 / 540

/** Screenshot pixels → mock pixels. */
function ux(value: number): number {
  return Math.round(value * USSD_SCALE * 100) / 100
}

/**
 * `৳1,250.00` → `1250.00`.
 *
 * The guide is handed an amount already formatted for the page, and USSD says
 * "Tk" and no separators. Without this the prompts read "Tk ৳1,250.00", and the
 * buyer copies a thousands separator into a field that will not take one.
 */
export function ussdAmount(amount: string): string {
  return amount.replace(/[^\d.]/g, '')
}

const SCREEN = '#191416'
const DIALOG = '#2b2b2b'
const KEY = '#241d20'
const TEXT = '#efe3e7'
const MUTED = '#9b8f93'
const LINK = '#8ab4f8'
const CALL = '#37be5f'
const ACCENT = '#f4b8cf'

/** The phone's own frame, shared by every screen in this flow. */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: SCREEN }}>
      {children}
    </div>
  )
}

/* ── 1. The dialler ───────────────────────────────────────────────────────── */

const ACTIONS = ['Create new contact', 'Add to a contact', 'Video call', 'Send a message']

const KEYS: Array<[string, string]> = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
]

export function DialerScreen({ code }: { code: string }) {
  return (
    <Screen>
      <div style={{ padding: `${ux(30)}px ${ux(28)}px 0` }}>
        {ACTIONS.map((action) => (
          <div
            key={action}
            className="flex items-center"
            style={{ height: ux(72), gap: ux(26), color: ACCENT, fontSize: ux(21) }}
          >
            <span
              style={{
                width: ux(28),
                height: ux(28),
                borderRadius: ux(6),
                border: `1.4px solid ${ACCENT}`,
                opacity: 0.85,
              }}
            />
            {action}
          </div>
        ))}
      </div>

      {/* The dialled code. Everything above is the dialler's own furniture; this
          is the only line the buyer has to get right. */}
      <div
        className="flex items-center justify-center"
        style={{
          margin: `${ux(24)}px ${ux(16)}px 0`,
          borderRadius: ux(24),
          backgroundColor: KEY,
          height: ux(96),
        }}
      >
        <span className="figure" style={{ fontSize: ux(46), color: TEXT, letterSpacing: '0.02em' }}>
          {code}
        </span>
      </div>

      <div
        className="grid flex-1 content-start"
        style={{
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: ux(14),
          padding: `${ux(16)}px ${ux(16)}px 0`,
        }}
      >
        {KEYS.map(([digit, letters]) => (
          <div
            key={digit}
            className="flex flex-col items-center justify-center"
            style={{ height: ux(96), borderRadius: ux(24), backgroundColor: KEY }}
          >
            <span className="figure" style={{ fontSize: ux(30), color: TEXT, lineHeight: 1 }}>
              {digit}
            </span>
            {letters ? (
              <span style={{ fontSize: ux(13), color: MUTED, letterSpacing: '0.08em' }}>
                {letters}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex justify-center" style={{ paddingBottom: ux(22) }}>
        <div
          className="flex items-center justify-center"
          style={{
            width: ux(150),
            height: ux(72),
            borderRadius: ux(36),
            backgroundColor: CALL,
            color: '#0d2a15',
            fontSize: ux(22),
            fontWeight: 600,
          }}
        >
          Call
        </div>
      </div>
    </Screen>
  )
}

/* ── 2–6. The USSD dialogs ────────────────────────────────────────────────── */

/**
 * A USSD prompt.
 *
 * `input` is what the buyer types; it is rendered on the entry line with a
 * highlight, because that value is the whole reason the screen is being shown.
 * A dialog with nothing to type passes `input: null` and gets a bare line.
 */
export function UssdDialogScreen({ body, input }: { body: React.ReactNode; input: string | null }) {
  return (
    <Screen>
      {/* The dimmed dialler behind. Present so the dialog reads as a system
          prompt sitting on top of something, not as a page of its own. */}
      <div className="relative flex-1 overflow-hidden">
        {/* Absolute, so `h-full` inside DialerScreen has a height to resolve
            against. Left in flow it collapsed to its content and stopped ~70px
            short of the frame, leaving a dead band under the keypad. */}
        <div className="absolute inset-0" style={{ opacity: 0.28, pointerEvents: 'none' }}>
          <DialerScreen code="*247#" />
        </div>
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} />

        {/* Centred rather than pinned to a fixed top: the root menu is eleven
            lines and "Enter Amount:" is one, and a dialog anchored for one of
            them sits wrong for the other. */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            data-ussd-dialog=""
            style={{
              width: ux(468),
              backgroundColor: DIALOG,
              borderRadius: ux(8),
              padding: `${ux(30)}px ${ux(32)}px ${ux(18)}px`,
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: ux(23), color: TEXT, lineHeight: 1.42 }}>{body}</div>

            <div
              className="flex items-end"
              style={{
                marginTop: ux(26),
                height: ux(46),
                borderBottom: `1.5px solid ${input ? ACCENT : '#4f9a97'}`,
              }}
            >
              {input ? (
                <span
                  className="figure"
                  style={{
                    fontSize: ux(25),
                    color: '#fff',
                    fontWeight: 600,
                    backgroundColor: 'rgba(226,19,110,0.42)',
                    borderRadius: ux(5),
                    padding: `${ux(2)}px ${ux(7)}px`,
                  }}
                >
                  {input}
                </span>
              ) : (
                // The caret bKash's prompt shows before anything is typed.
                <span
                  style={{
                    width: ux(3),
                    height: ux(30),
                    backgroundColor: '#4f9a97',
                    marginBottom: ux(3),
                  }}
                />
              )}
            </div>

            <div
              className="flex items-center justify-end"
              style={{ gap: ux(46), marginTop: ux(24), height: ux(50) }}
            >
              <span style={{ fontSize: ux(22), color: LINK, letterSpacing: '0.03em' }}>CANCEL</span>
              {/* Marked so the walkthrough can read its real position instead of
                  the tap pointer relying on a guessed percentage — the dialog
                  height changes with the prompt, and SEND moves with it. */}
              <span
                data-ussd-send=""
                style={{ fontSize: ux(22), color: LINK, letterSpacing: '0.03em' }}
              >
                SEND
              </span>
            </div>
          </div>
        </div>
      </div>
    </Screen>
  )
}

/** The bKash USSD root menu, verbatim. */
export const USSD_MENU = [
  '1 Send Money',
  '2 Send Money to Non-bKash User',
  '3 Mobile Recharge',
  '4 Payment',
  '5 Cash Out',
  '6 Pay Bill',
  '7 Microfinance',
  '8 Download bKash App',
  '9 My bKash',
  '10 Reset PIN',
]

export function MenuBody() {
  return (
    <>
      <div style={{ marginBottom: ux(6) }}>bKash</div>
      {USSD_MENU.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </>
  )
}

/* ── 7. Waiting, the last beat ───────────────────────────────────────────────────────────── */

export function RunningScreen() {
  return (
    <Screen>
      <div className="relative flex-1 overflow-hidden">
        {/* Absolute, so `h-full` inside DialerScreen has a height to resolve
            against. Left in flow it collapsed to its content and stopped ~70px
            short of the frame, leaving a dead band under the keypad. */}
        <div className="absolute inset-0" style={{ opacity: 0.28, pointerEvents: 'none' }}>
          <DialerScreen code="" />
        </div>
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} />

        <div className="absolute inset-x-0 flex justify-center" style={{ top: ux(560) }}>
          <div
            className="flex items-center"
            style={{
              gap: ux(28),
              backgroundColor: '#2f2629',
              borderRadius: ux(28),
              padding: `${ux(22)}px ${ux(44)}px`,
              boxShadow: '0 10px 26px rgba(0,0,0,0.45)',
            }}
          >
            <span
              className="animate-spin"
              style={{
                width: ux(30),
                height: ux(30),
                borderRadius: '50%',
                border: `2px solid ${ACCENT}`,
                borderTopColor: 'transparent',
              }}
            />
            <span style={{ fontSize: ux(23), color: TEXT }}>USSD code running…</span>
          </div>
        </div>
      </div>
    </Screen>
  )
}
