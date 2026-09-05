import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SetupWizard } from '@/components/setup/setup-wizard'
import { requireAdmin } from '@/lib/auth/session'
import { getSetupState } from '@/lib/services/onboarding'

/**
 * First-run setup, outside the dashboard shell on purpose.
 *
 * The sidebar links to six screens that cannot do anything useful yet, so
 * showing it here would be offering exits from the one page that matters.
 *
 * Still behind `requireAdmin`: this creates receiving accounts and API keys,
 * which is not something an anonymous visitor may do because the instance
 * happens to be new.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Set up Jomma' }

export default async function SetupPage() {
  await requireAdmin()
  const state = await getSetupState()

  // Finished instances have no business here. Reachable again the moment
  // something required is removed, because the state is computed, not stored.
  if (state.complete && state.currentStepId === null) redirect('/')

  return <SetupWizard initial={state} />
}
