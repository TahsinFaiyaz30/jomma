'use client'

import type { Provider } from '@jomma/shared'
import type { ComponentType } from 'react'
import { BkashGuide, type GuideData } from './guide'

/**
 * Which walkthrough belongs to which payment method.
 *
 * A guide is provider-specific by nature — Nagad's Send Money flow is not
 * bKash's, and a bank transfer or a card is a different shape entirely. So the
 * mapping is explicit rather than assumed, and a provider with no guide yet
 * degrades to the instructions instead of rendering somebody else's screens.
 *
 * Adding one is: build the screens, add the entry here. Nothing else changes.
 */

export type { GuideData }

const GUIDES: Partial<Record<Provider, ComponentType<{ data: GuideData }>>> = {
  bkash: BkashGuide,
  // nagad: pending. Its message format is still unverified (AGENTS.md open
  // decision #2), so it cannot be offered at checkout at all yet — building a
  // walkthrough for a method nobody can select would be the wrong order.
}

export function hasGuide(provider: Provider): boolean {
  return provider in GUIDES
}

/** The walkthrough for this provider, or nothing if there is not one yet. */
export function ProviderGuide({ provider, data }: { provider: Provider; data: GuideData }) {
  const Guide = GUIDES[provider]
  if (!Guide) return null
  return <Guide data={data} />
}
