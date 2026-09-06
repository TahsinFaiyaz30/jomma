import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SetupWizard } from '@/components/setup/setup-wizard'
import { requireBusiness } from '@/lib/auth/tenancy'
import { getSetupState, markSetupComplete } from '@/lib/services/onboarding'

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
  const { business } = await requireBusiness()
  const state = await getSetupState(business.id)

  /*
   * Stamp the moment every required step is satisfied.
   *
   * Doing it here rather than only in the actions also migrates an instance
   * that was already working before the stamp existed: it gets sent here once,
   * finds nothing to do, records that fact, and is never sent again.
   */
  if (state.complete) await markSetupComplete()

  // Nothing left at all, not even the optional step: there is no page to show.
  if (state.currentStepId === null) redirect('/')

  return <SetupWizard initial={state} />
}
