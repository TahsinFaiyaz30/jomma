#!/usr/bin/env node
/**
 * Applies migrations to a deployed database.
 *
 * `pnpm db:migrate` already does it. What it does not do is give you anywhere
 * safe to put the connection string, and the documented invocation is
 * shell-specific in a way that bites:
 *
 *   DATABASE_URL='postgres://…' pnpm db:migrate     # bash
 *   $env:DATABASE_URL='postgres://…'; pnpm db:migrate   # PowerShell
 *
 * The first form typed into PowerShell fails with "is not recognized as a name
 * of a cmdlet", which reads as a broken command rather than the wrong shell —
 * and the URL is on screen and in history either way. Unquoted, PowerShell also
 * eats the `?` and `&` that every hosted Postgres URL carries.
 *
 *   node scripts/migrate-remote.mjs
 *
 * Deliberately separate from the deploy. `docs/deploy.md` keeps migrations
 * manual on purpose: one that fails partway through on a payments database is
 * a worse morning than one you ran yourself and watched.
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web')

const rl = createInterface({ input: process.stdin, output: process.stdout })

/*
 * `rl.question` never calls back once stdin reaches EOF, so a promise around it
 * never settles and Node exits *zero* — a migration script that reports success
 * having done nothing is the worst answer available.
 */
let abort = null
rl.on('close', () => abort?.())

function ask(question) {
  return new Promise((done, fail) => {
    abort = () => fail(new Error('Input ended before the connection string was given.'))
    rl.question(question, (answer) => {
      abort = null
      done(answer.trim())
    })
  })
}

/** Host only. Enough to confirm the target, with the password left out of it. */
function describe(url) {
  try {
    const { hostname, pathname } = new URL(url)
    return `${hostname}${pathname}`
  } catch {
    return null
  }
}

async function main() {
  console.log(`
Applying migrations to a deployed database.

  Paste the connection string. It is not written to disk and does not enter
  your shell history.
`)

  const databaseUrl = await ask('  DATABASE_URL : ')
  if (!databaseUrl) throw new Error('A DATABASE_URL is required.')

  const target = describe(databaseUrl)
  if (!target) throw new Error('That does not parse as a connection string.')

  // Shown back without the credentials in it, because pasting the wrong
  // environment's URL is the mistake this is most likely to be part of.
  const confirmed = await ask(`\n  Migrate ${target}? [y/N] : `)
  if (confirmed.toLowerCase() !== 'y') throw new Error('Nothing was applied.')

  console.log('\n  Migrating…\n')
  rl.close()

  const child = spawn('pnpm', ['db:migrate'], {
    cwd: WEB,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  })

  child.on('exit', (code) => process.exit(code ?? 1))
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`)
  process.exit(1)
})
