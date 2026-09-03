import type { Metadata } from 'next'
import { TokensExplorer } from './tokens-explorer'

export const metadata: Metadata = {
  title: 'Tokens',
}

/**
 * Every token and every component state, in all three theme modes and both
 * locales. docs/design.md build order step 5: this page exists so inconsistency
 * is caught here rather than retrofitted across a finished UI later.
 */
export default function TokensPage() {
  return <TokensExplorer />
}
