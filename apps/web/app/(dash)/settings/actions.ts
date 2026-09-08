'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/auth/tenancy'
import { db } from '@/lib/db/client'
import { businesses } from '@/lib/db/schema'

/**
 * Naming the merchant this instance is.
 *
 * There was nowhere to do this. A self-hosted deployment creates its single
 * business automatically — nobody is asked, because being asked before you can
 * see anything is a worse first run — and it was called "My shop" for good,
 * with no screen anywhere offering to change it.
 *
 * That went unnoticed while the name was only ever shown to the person who
 * already knew which instance they were on. It stopped being invisible when the
 * app started naming the merchant each phone helps: a handset serving three
 * shops lists them by name, and "My shop" is no use at all next to two real
 * ones. Somebody looking at that screen had no idea where the name came from —
 * they had never typed it — and the closest thing they *had* named was an app,
 * which the setup wizard was calling a business at the time.
 *
 * The slug is deliberately left alone. It is in URLs and in the pairing codes
 * phones already hold, so renaming is a display change and nothing more.
 */
export async function renameBusinessAction(
  name: string,
): Promise<{ ok: boolean; message: string }> {
  const { business } = await requireWriteAccess()

  const trimmed = name.trim()
  if (trimmed.length < 2) return { ok: false, message: 'Give the business a name.' }
  if (trimmed.length > 80) return { ok: false, message: 'That name is too long.' }
  if (trimmed === business.name) return { ok: true, message: 'That is already the name.' }

  await db.update(businesses).set({ name: trimmed }).where(eq(businesses.id, business.id))

  revalidatePath('/settings')
  revalidatePath('/', 'layout')

  return {
    ok: true,
    // Says where it will show up, because the point of renaming it is usually
    // the phone rather than this page.
    message: `Renamed to ${trimmed}. Paired phones pick it up on their next heartbeat.`,
  }
}
