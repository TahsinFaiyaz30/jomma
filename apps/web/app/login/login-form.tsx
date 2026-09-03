'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { signIn } from '@/lib/auth/client'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)

    const result = await signIn.email({ email, password })

    if (result.error) {
      /*
       * A rejected credential stays deliberately vague — distinguishing "no such
       * user" from "wrong password" lets someone enumerate which addresses have
       * accounts.
       *
       * Anything else is a misconfiguration, not a bad password, and saying
       * "credentials not accepted" for a 403 origin mismatch sends whoever is
       * setting this up hunting for the wrong problem.
       */
      const status = result.error.status
      setError(
        status === 401
          ? 'Those credentials were not accepted.'
          : `Sign-in failed (${status ?? 'network error'}). This is a configuration problem, not a wrong password — check APP_URL matches the address you are using.`,
      )
      setPending(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error ? (
        <p className="rounded-md bg-offline-subtle px-3 py-2 text-small text-offline-subtle-foreground">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        Sign in
      </Button>
    </form>
  )
}
