'use client'

/**
 * Service glyphs for the home grid, and the bottom-tab glyphs.
 *
 * Drawn, not copied. bKash's own icons are illustrated artwork; these are plain
 * geometry in the same colour for each service, which is as close as a redraw
 * legitimately gets. What matters for the guide is that the eight tiles are
 * distinguishable from one another, so the buyer can find Send Money by shape
 * rather than by reading all eight labels.
 */

export type GlyphName =
  | 'send'
  | 'recharge'
  | 'cashout'
  | 'payment'
  | 'addmoney'
  | 'paybill'
  | 'savings'
  | 'loan'

export function ServiceGlyph({
  name,
  size,
  color,
}: {
  name: GlyphName
  size: number
  color: string
}) {
  const common = {
    viewBox: '0 0 32 32',
    style: { width: size, height: size },
    fill: 'none',
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  switch (name) {
    case 'send':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 12h9M2 16h11M4 20h9" />
          <circle cx="21" cy="16" r="7" />
          <path d="M21 12v8M19 14.2h3.4M19 17.8h3.4" strokeWidth="1.6" />
        </svg>
      )
    case 'recharge':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="10" y="4" width="12" height="24" rx="2.5" />
          <path d="M16 10v9M13.8 12h4.4M13.8 16h4.4" strokeWidth="1.5" />
        </svg>
      )
    case 'cashout':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 20c2-2 5-2 7 0l3 2h5" />
          <rect x="14" y="7" width="14" height="9" rx="1.6" />
          <circle cx="21" cy="11.5" r="2.2" strokeWidth="1.5" />
        </svg>
      )
    case 'payment':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M7 11h18l-1.6 16H8.6z" />
          <path d="M12 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      )
    case 'addmoney':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="4" y="9" width="24" height="15" rx="2.5" />
          <path d="M4 14h24" strokeWidth="1.5" />
          <path d="M22 18.5h4M24 16.5v4" strokeWidth="1.6" />
        </svg>
      )
    case 'paybill':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M16 4a7 7 0 0 1 4 12.7V20h-8v-3.3A7 7 0 0 1 16 4Z" />
          <path d="M13 24h6M14 27h4" strokeWidth="1.6" />
        </svg>
      )
    case 'savings':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M6 17a9 7 0 0 1 20 0 9 7 0 0 1-20 0Z" />
          <path d="M13 8.5h6M16 5v3.5" strokeWidth="1.6" />
          <path d="M10 23v3M22 23v3" strokeWidth="1.6" />
        </svg>
      )
    case 'loan':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M11 10h10l4 8.5a6 6 0 0 1-5.4 8.5h-7.2A6 6 0 0 1 7 18.5Z" />
          <path d="M12.5 6.5h7l-1.5 3.5h-4z" strokeWidth="1.6" />
        </svg>
      )
    default:
      return null
  }
}

export function TabGlyph({
  name,
  size,
  color,
  filled,
}: {
  name: 'home' | 'wallet' | 'qr' | 'inbox'
  size: number
  color: string
  filled: boolean
}) {
  const common = {
    viewBox: '0 0 24 24',
    style: { width: size, height: size },
    fill: 'none',
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  switch (name) {
    case 'home':
      return (
        <svg {...common} fill={filled ? color : 'none'} aria-hidden="true">
          <path d="M3.5 11 12 4l8.5 7v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
        </svg>
      )
    case 'wallet':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3.5" y="6" width="17" height="13" rx="2.5" />
          <path d="M3.5 10.5h17" strokeWidth="1.5" />
        </svg>
      )
    case 'qr':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M20 8.5V6a2 2 0 0 0-2-2h-2.5M4 15.5V18a2 2 0 0 0 2 2h2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5" />
        </svg>
      )
    case 'inbox':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
          <path d="m3.5 8 8.5 5.5L20.5 8" strokeWidth="1.5" />
        </svg>
      )
    default:
      return null
  }
}

/** The three cards above the contact list on the Send Money picker. */
export function PickerGlyph({
  name,
  size,
  color,
}: {
  name: 'priyo' | 'autopay' | 'group'
  size: number
  color: string
}) {
  const common = {
    viewBox: '0 0 32 32',
    style: { width: size, height: size },
    fill: 'none',
    stroke: color,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  switch (name) {
    case 'priyo':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="6" y="4" width="20" height="24" rx="2.5" />
          <path d="M6 9H3M6 16H3M6 23H3" strokeWidth="1.6" />
          <circle cx="15" cy="14" r="3" strokeWidth="1.6" />
          <path d="M10 23c1-3 3-4 5-4s4 1 5 4" strokeWidth="1.6" />
          <path d="m24 4 1.1 2.3 2.5.4-1.8 1.8.4 2.5L24 9.8l-2.2 1.2.4-2.5-1.8-1.8 2.5-.4z" />
        </svg>
      )
    case 'autopay':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M26 16a10 10 0 1 1-3.5-7.6" />
          <path d="M26 5v5h-5" />
          <path d="M16 11v10M13.5 13.5h5M13.5 18.5h5" strokeWidth="1.5" />
        </svg>
      )
    case 'group':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="16" cy="11" r="4" />
          <path d="M9 24c1.5-4 4-6 7-6s5.5 2 7 6" />
          <circle cx="6" cy="13" r="3" strokeWidth="1.6" />
          <circle cx="26" cy="13" r="3" strokeWidth="1.6" />
        </svg>
      )
    default:
      return null
  }
}
