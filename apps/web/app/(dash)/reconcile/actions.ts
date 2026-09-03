'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth/session'
import { type ImportResult, importStatement } from '@/lib/services/statement-import'

export async function importStatementAction(
  receivingAccountId: string,
  csv: string,
): Promise<{ ok: boolean; message: string; result?: ImportResult }> {
  const admin = await requireAdmin()

  if (!csv.trim()) return { ok: false, message: 'Nothing to import.' }
  if (csv.length > 5_000_000) return { ok: false, message: 'That file is too large (5MB limit).' }

  try {
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
