'use client'

/**
 * Shared bKash chrome: colours, the header, and the icon set.
 *
 * Split out from the screens so the measurements live in one place. Every size
 * here is derived from the reference screenshots at their native 914px width,
 * scaled to the 280px mock — `px(n)` does that conversion, so a value copied off
 * a screenshot can be pasted in directly and lands in the right place.
 */

export const PINK = '#e2136e'
export const PINK_DARK = '#7a0b3c'

/** Reference screenshots are 914 CSS px wide; the mock is 280. */
export const SCALE = 280 / 914

/** Screenshot pixels → mock pixels. */
export function px(value: number): number {
  return Math.round(value * SCALE * 100) / 100
}

/**
 * The origami bird.
 *
 * A simplified two-triangle silhouette, not a copy of bKash's artwork — close
 * enough to read as the same mark in a 20px slot, and drawn rather than lifted.
 */
export function Bird({ size = 18, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill={color} aria-hidden="true">
      <path d="M2 9.5 22 3l-8.2 8.6z" opacity="0.95" />
      <path d="M8.4 13.2 22 3l-5.6 18-3.1-6.2z" />
    </svg>
  )
}

export function SearchGlyph({ size = 20, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth="2" />
      <path d="m19.5 19.5-4.2-4.2" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The pink app bar: back arrow, centred title, bird.
 *
 * Height and type size come straight off the reference — 127px tall with a 40px
 * title at 914 wide.
 */
export function AppBar({ title, dimmed = false }: { title: string; dimmed?: boolean }) {
  return (
    <div
      className="flex shrink-0 items-center"
      style={{
        backgroundColor: dimmed ? PINK_DARK : PINK,
        height: px(127),
        paddingLeft: px(36),
        paddingRight: px(36),
      }}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: px(56), height: px(56) }}
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M20 12H4m0 0 7-7m-7 7 7 7"
          stroke={dimmed ? 'rgba(255,255,255,0.55)' : '#fff'}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <span
        className="flex-1 text-center"
        style={{
          fontSize: px(40),
          fontWeight: 600,
          color: dimmed ? 'rgba(255,255,255,0.55)' : '#fff',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </span>

      <div style={{ opacity: dimmed ? 0.55 : 1 }}>
        <Bird size={px(56)} />
      </div>
    </div>
  )
}

/**
 * The search input, used on the picker and carried through the next two screens.
 * 97px tall with a 36px side margin and 34px text at reference width.
 */
export function SearchField({ value, placeholder }: { value?: string; placeholder?: string }) {
  return (
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
        <span
          className={value ? 'figure' : undefined}
          style={{ fontSize: px(34), color: value ? '#1f2937' : '#a9a9a9' }}
        >
          {value ?? placeholder}
        </span>
      </div>
    </div>
  )
}

/** The 6px grey band bKash uses between sections. */
export function Band() {
  return <div style={{ height: px(20), backgroundColor: '#f1f1f1' }} />
}

export function Divider() {
  return <div style={{ height: 1, backgroundColor: '#ededed' }} />
}

/**
 * A recipient row: coloured initial disc, number bold, number again beneath.
 * bKash shows the contact name on top; with no contact saved it repeats the
 * number, which is what a buyer paying a store will actually see.
 */
export function Recipient({ msisdn }: { msisdn: string }) {
  return (
    <div className="flex items-center" style={{ gap: px(30), padding: `${px(24)}px ${px(36)}px` }}>
      <div
        className="flex shrink-0 items-center justify-center"
        style={{
          width: px(96),
          height: px(96),
          borderRadius: '50%',
          backgroundColor: '#aab4e8',
          color: '#fff',
          fontSize: px(38),
        }}
      >
        0
      </div>
      <div className="min-w-0">
        <p className="figure" style={{ fontSize: px(38), fontWeight: 600, color: '#111' }}>
          {msisdn}
        </p>
        <p className="figure" style={{ fontSize: px(34), color: '#8b8b8b' }}>
          {msisdn}
        </p>
      </div>
    </div>
  )
}
