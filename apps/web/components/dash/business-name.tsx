'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { renameBusinessAction } from '@/app/(dash)/settings/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * What this merchant is called, everywhere it is named.
 *
 * Small, and it closes a real hole: a self-hosted instance names its business
 * "My shop" on its own and offered no way to change it. That was invisible
 * until phones started listing the merchants they help by name, at which point
 * a handset serving three shops showed "My shop" beside two real ones — a name
 * nobody had typed, from a screen that did not exist.
 */
export function BusinessName({ name }: { name: string }) {
  const [value, setValue] = useState(name)
  const [pending, startTransition] = useTransition()

  const save = () =>
    startTransition(async () => {
      const result = await renameBusinessAction(value)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Karim Store"
        aria-label="Business name"
        className="h-8 max-w-64 text-small"
        maxLength={80}
      />
      <Button
        size="sm"
        // Nothing to save is not an error worth a red toast, so it is simply
        // unavailable until the name actually differs.
        disabled={pending || value.trim().length < 2 || value.trim() === name}
        onClick={save}
      >
        Save
      </Button>
    </div>
  )
}
