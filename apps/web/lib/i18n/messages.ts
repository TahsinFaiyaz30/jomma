import type { Locale } from '@jomma/shared'

/**
 * Dashboard copy. Flat keys, dot-namespaced.
 *
 * Note the boundary: this is *operator* copy for the admin dashboard. Buyer-
 * facing copy does not live in Jomma at all — docs/api.md is explicit that the
 * client renders the message and Jomma only supplies the numbers.
 */

export const messages = {
  en: {
    'app.name': 'Jomma',
    'app.tagline': 'Payment verification',

    'nav.feed': 'Feed',
    'nav.queue': 'Queue',
    'nav.intents': 'Intents',
    'nav.accounts': 'Accounts',
    'nav.reconcile': 'Reconcile',
    'nav.apps': 'Apps',
    'nav.settings': 'Settings',

    'status.matched': 'Matched',
    'status.pending': 'Pending',
    'status.unmatched': 'Unmatched',
    'status.ambiguous': 'Ambiguous',
    'status.offline': 'Offline',
    'status.open': 'Open',
    'status.partial': 'Partial',
    'status.over': 'Overpaid',
    'status.expired': 'Expired',
    'status.cancelled': 'Cancelled',
    'status.orphaned': 'Orphaned',
    'status.refunded': 'Refunded',
    'status.active': 'Active',
    'status.degraded': 'Degraded',
    'status.disabled': 'Disabled',

    'feed.title': 'Feed',
    'feed.empty.title': 'No payments yet',
    'feed.empty.description': 'Incoming payments appear here the moment a device captures them.',
    'feed.search': 'Search TrxID, reference, or number',
    'feed.announce': 'Payment received',
    'feed.live': 'Live',
    'feed.paused': 'Paused',
    'feed.column.time': 'Time',
    'feed.column.amount': 'Amount',
    'feed.column.sender': 'Sender',
    'feed.column.reference': 'Reference',
    'feed.column.status': 'Status',
    'feed.column.account': 'Account',
    'feed.rowCount': 'payments',

    'account.health': 'Account health',
    'account.lastCapture': 'Last capture',
    'account.lastHeartbeat': 'Last heartbeat',
    'account.balanceDrift': 'Balance drift',
    'account.ok': 'ok',
    'account.utilization': 'Daily limit',

    'theme.label': 'Theme',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.system': 'System',

    'locale.label': 'Language',

    'action.approve': 'Approve',
    'action.reject': 'Reject',
    'action.open': 'Open',
    'action.search': 'Search',
    'action.close': 'Close',
    'action.commandPalette': 'Command palette',

    'shortcut.move': 'Move',
    'shortcut.open': 'Open',
    'shortcut.approve': 'Approve',
    'shortcut.reject': 'Reject',
    'shortcut.search': 'Search',
    'shortcut.palette': 'Command palette',
  },

  bn: {
    'app.name': 'জমা',
    'app.tagline': 'পেমেন্ট যাচাই',

    'nav.feed': 'ফিড',
    'nav.queue': 'সারি',
    'nav.intents': 'অনুরোধ',
    'nav.accounts': 'অ্যাকাউন্ট',
    'nav.reconcile': 'মিলকরণ',
    'nav.apps': 'অ্যাপ',
    'nav.settings': 'সেটিংস',

    'status.matched': 'মিলেছে',
    'status.pending': 'অপেক্ষমাণ',
    'status.unmatched': 'মেলেনি',
    'status.ambiguous': 'অস্পষ্ট',
    'status.offline': 'বন্ধ',
    'status.open': 'খোলা',
    'status.partial': 'আংশিক',
    'status.over': 'অতিরিক্ত',
    'status.expired': 'মেয়াদোত্তীর্ণ',
    'status.cancelled': 'বাতিল',
    'status.orphaned': 'দাবিহীন',
    'status.refunded': 'ফেরত',
    'status.active': 'সক্রিয়',
    'status.degraded': 'দুর্বল',
    'status.disabled': 'নিষ্ক্রিয়',

    'feed.title': 'ফিড',
    'feed.empty.title': 'এখনও কোনো পেমেন্ট নেই',
    'feed.empty.description': 'ডিভাইস কোনো লেনদেন ধরার সঙ্গে সঙ্গে এখানে দেখা যাবে।',
    'feed.search': 'TrxID, রেফারেন্স বা নম্বর খুঁজুন',
    'feed.announce': 'পেমেন্ট এসেছে',
    'feed.live': 'সরাসরি',
    'feed.paused': 'থেমে আছে',
    'feed.column.time': 'সময়',
    'feed.column.amount': 'পরিমাণ',
    'feed.column.sender': 'প্রেরক',
    'feed.column.reference': 'রেফারেন্স',
    'feed.column.status': 'অবস্থা',
    'feed.column.account': 'অ্যাকাউন্ট',
    'feed.rowCount': 'পেমেন্ট',

    'account.health': 'অ্যাকাউন্টের অবস্থা',
    'account.lastCapture': 'সর্বশেষ লেনদেন',
    'account.lastHeartbeat': 'সর্বশেষ সংকেত',
    'account.balanceDrift': 'ব্যালেন্স গরমিল',
    'account.ok': 'ঠিক আছে',
    'account.utilization': 'দৈনিক সীমা',

    'theme.label': 'থিম',
    'theme.light': 'আলো',
    'theme.dark': 'অন্ধকার',
    'theme.system': 'সিস্টেম',

    'locale.label': 'ভাষা',

    'action.approve': 'অনুমোদন',
    'action.reject': 'বাতিল',
    'action.open': 'খুলুন',
    'action.search': 'খুঁজুন',
    'action.close': 'বন্ধ',
    'action.commandPalette': 'কমান্ড প্যালেট',

    'shortcut.move': 'সরান',
    'shortcut.open': 'খুলুন',
    'shortcut.approve': 'অনুমোদন',
    'shortcut.reject': 'বাতিল',
    'shortcut.search': 'খুঁজুন',
    'shortcut.palette': 'কমান্ড প্যালেট',
  },
} as const satisfies Record<Locale, Record<string, string>>

export type MessageKey = keyof (typeof messages)['en']

/**
 * Falls back to English, then to the key itself. A missing Bengali string shows
 * readable English rather than a raw key in the middle of the UI.
 */
export function translate(locale: Locale, key: MessageKey): string {
  const table = messages[locale] as Record<string, string | undefined>
  return table[key] ?? messages.en[key] ?? key
}
