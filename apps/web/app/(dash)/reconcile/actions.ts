'use server'

import { newRequestId } from '@jomma/shared'
import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/auth/tenancy'
import { assertOwnsReceivingAccount } from '@/lib/services/businesses'
import { ingestManualEntry, type ManualEntryResult } from '@/lib/services/manual-entry'
import { type ImportResult, importStatement } from '@/lib/services/statement-import'

export async function importStatementAction(
  receivingAccountId: string,
  csv: string,
): Promise<{ ok: boolean; message: string; result?: ImportResult }> {
  const { user: admin, business } = await requireWriteAccess()

  if (!csv.trim()) return { ok: false, message: 'Nothing to import.' }
  if (csv.length > 5_000_000) return { ok: false, message: 'That file is too large (5MB limit).' }

  try {
    await assertOwnsReceivingAccount(business.id, receivingAccountId)
    const result = await importStatement({ receivingAccountId, csv, actorId: admin.id })
    revalidatePath('/reconcile')
    revalidatePath('/queue')
    revalidatePath('/')

    return {
      ok: true,
      message:
        result.recovered === 0
          ? `${result.duplicates} rows already known. Nothing was missed.`
          : `${result.recovered} payment${result.recovered === 1 ? '' : 's'} the notifier never saw.`,
      result,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Import failed.' }
  }
}

/**
 * Manual entry — the always-available path.
 *
 * Same pipeline as a device capture. Requires an admin, and the audit trail
 * records who typed it, because a payment credited from a pasted string should
 * be attributable to a person.
 */
export async function manualEntryAction(
  receivingAccountId: string,
  raw: string,
): Promise<{ ok: boolean; message: string; result?: ManualEntryResult }> {
  const { user: admin, business } = await requireWriteAccess()
  const requestId = newRequestId()

  if (!raw.trim()) return { ok: false, message: 'Nothing to import.' }

  try {
    await assertOwnsReceivingAccount(business.id, receivingAccountId)
    const result = await ingestManualEntry({
      receivingAccountId,
      raw,
      actorId: admin.id,
      requestId,
    })

    revalidatePath('/reconcile')
    revalidatePath('/queue')
    revalidatePath('/')

    const message =
      result.status === 'duplicate'
        ? 'Already captured — nothing duplicated.'
        : result.status === 'unparsed'
          ? 'Stored, but the parser could not read it. It is in the queue.'
          : result.matched
            ? 'Imported and matched to an intent.'
            : 'Imported. Nothing claims it yet, so it is in the queue.'

    return { ok: true, message, result }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Import failed.' }
  }
}
