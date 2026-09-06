'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { signUp } from '@/lib/auth/client'

/**
 * Creating an account, in service mode only.
 *
 * Registering buys nothing on its own, which is what makes opening it safe: the
 * new user is a `member` with no business, and the business they create next
 * starts `pending` and cannot take a payment until a platform admin approves
 * it. The gate is on the money, not on the account — making people wait for a
 * login only teaches them to give up before you have learned anything about
 * them.
 */
export function SignupForm() {
  const router = useRouter()
  const nameId = useId()
  const emailId = useId()
  const passwordId = useId()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    // Matches `minPasswordLength` on the server. Checking here too so the
    // failure arrives before a round trip rather than as a generic 422.
    if (password.length < 12) {
      setError('Use at least 12 characters.')
      return
    }

    setPending(true)
    const result = await signUp.email({ email, password, name: name.trim() || email })

    if (result.error) {
      /*
       * "Already registered" is not treated as secret here, unlike on sign-in.
       * Sign-up necessarily reveals whether an address is taken — the account
       * either gets created or it does not — so pretending otherwise would cost
       * clarity and buy nothing.
       */
      setError(
        result.error.status === 422
          ? 'That email is already registered. Sign in instead.'
          : (result.error.message ?? 'Could not create the account.'),
      )
      setPending(false)
      return
    }

    // Straight to registering a business: an account with none is a dead end,
    // and it is the only thing they can usefully do next.
    router.push('/businesses/new')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>Your name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={emailId}>Email</Label>
        <Input
          id={emailId}
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={passwordId}>Password</Label>
        <Input
          id={passwordId}
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
        <p className="text-micro text-muted-foreground">At least 12 characters.</p>
      </div>

      {error ? <p className="text-red-600 text-small dark:text-red-500">{error}</p> : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        Create account
      </Button>
    </form>
  )
}
