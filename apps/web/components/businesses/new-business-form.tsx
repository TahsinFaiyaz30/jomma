'use client'

import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { createBusinessAction } from '@/app/businesses/new/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'

/**
 * Registering a merchant.
 *
 * Everything but the name is optional, and the optional fields are asked for
 * anyway because a human has to approve this. A form with only a name gives
 * them nothing to decide on, and the decision then happens in a chat thread
 * that never makes it back into the record.
 */
export function NewBusinessForm({ email }: { email: string }) {
  const nameId = useId()
  const emailId = useId()
  const phoneId = useId()
  const aboutId = useId()

  const [name, setName] = useState('')
  const [contactEmail, setContactEmail] = useState(email)
  const [contactPhone, setContactPhone] = useState('')
  const [description, setDescription] = useState('')
  const [pending, startTransition] = useTransition()

  const submit = () => {
    if (name.trim().length < 2) {
      toast.error('Give the business a name.')
      return
    }

    startTransition(async () => {
      const result = await createBusinessAction({ name, contactEmail, contactPhone, description })
      // Only a failure returns; success redirects, so there is nothing to
      // report here on the happy path.
      if (!result.ok) toast.error(result.message)
    })
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center gap-6 p-6">
      <div className="space-y-1.5">
        <h1 className="font-semibold text-2xl tracking-tight">Register your business</h1>
        <p className="text-muted-foreground text-sm">
          You can set everything up straight away. Taking real payments needs an approval first — it
          is a person reading this, so the more you say the faster it goes.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>Business name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Rahim Electronics"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={emailId}>
            Contact email <Optional />
          </Label>
          <Input
            id={emailId}
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={phoneId}>
            Contact phone <Optional />
          </Label>
          <Input
            id={phoneId}
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            placeholder="01700000000"
            inputMode="tel"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={aboutId}>
            What do you sell? <Optional />
          </Label>
          <Textarea
            id={aboutId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Phone accessories, delivered across Dhaka. Around 40 orders a week."
            rows={3}
          />
        </div>
      </div>

      <Button onClick={submit} disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        Create business
      </Button>
    </div>
  )
}

function Optional() {
  return <span className="font-normal text-muted-foreground">(optional)</span>
}
