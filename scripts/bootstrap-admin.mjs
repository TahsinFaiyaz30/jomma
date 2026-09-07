#!/usr/bin/env node
/**
 * Creates the first admin on a deployed instance.
 *
 * `pnpm db:seed --admin-only` already does the work. What it does not do is
 * give you anywhere safe to put the two secrets it needs: the documented
 * invocation puts a production connection string and a password on the command
 * line, where they land in shell history, in `ps` output for every other
 * process on the machine, and — if you are asking someone for help — in a chat
 * log. On a single-tenant instance that is closed to signup, this is the only
 * way in, so it is the one command every operator runs exactly once, at the
 * moment they are least familiar with the project.
 *
 * So this prompts instead. The password is read without echo, nothing is
 * written to disk, and the values are handed to the seed as environment
 * variables of a child process rather than as arguments.
 *
 *   node scripts/bootstrap-admin.mjs
 *
 * It refuses to invent a password. A generated one has to be copied out of a
 * terminal, which is how it ends up pasted somewhere it should not be.
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web')

/*
 * One interface for every prompt.
 *
 * Creating a fresh `readline` per question reads naturally and is wrong: the
 * first one to close takes the buffered stdin with it, so on anything that is
 * not an interactive terminal the second prompt receives nothing and the script
 * hangs. Sharing one, and muting it for the answers that should not be echoed,
 * works the same way at a terminal and can also be driven by a pipe.
 */
const rl = createInterface({ input: process.stdin, output: process.stdout })

let muted = false
const write = rl._writeToOutput?.bind(rl)
rl._writeToOutput = (chunk) => {
  if (!muted) write?.(chunk)
}

/*
 * Answered, or the input ended.
 *
 * `rl.question` simply never calls back when stdin reaches EOF, so a promise
 * wrapped around it never settles — and a Node process with nothing left to do
 * exits **zero**. Piping into this, or running it where no terminal is
 * attached, therefore reported success and created no admin, which is the worst
 * answer available for the one command that stands between an operator and
 * their dashboard.
 */
let abort = null
rl.on('close', () => abort?.())

function prompt(question, secret = false) {
  return new Promise((done, fail) => {
    abort = () => fail(new Error('Input ended before every question was answered.'))

    if (secret) {
      // The prompt stays visible; only the typing is hidden.
      process.stdout.write(question)
      muted = true
    }

    rl.question(secret ? '' : question, (answer) => {
      abort = null
      if (secret) {
        muted = false
        // The Return that ended the answer was swallowed with everything else.
        process.stdout.write('\n')
      }
      done(answer.trim())
    })
  })
}

const ask = (question) => prompt(question)
/** As `ask`, but the answer is not echoed. */
const askSecret = (question) => prompt(question, true)

async function main() {
  console.log(`
Bootstrapping the first admin.

  Nothing is written to disk and nothing appears in your shell history. The
  password is not echoed as you type it.
`)

  const databaseUrl = await ask('  Production DATABASE_URL : ')
  if (!databaseUrl) throw new Error('A DATABASE_URL is required.')

  if (/localhost|127\.0\.0\.1/.test(databaseUrl)) {
    console.log('\n  That is a local database. Use `pnpm db:seed` for development.\n')
  }

  const email = await ask('  Admin email             : ')
  if (!email.includes('@')) throw new Error('That does not look like an email address.')

  const password = await askSecret('  Admin password          : ')
  const again = await askSecret('  Confirm password        : ')

  if (password !== again) throw new Error('The passwords do not match.')
  // Better Auth's own floor. Failing here beats failing after the connection.
  if (password.length < 8) throw new Error('Use at least 8 characters.')

  console.log('\n  Creating…\n')

  // Released before the child inherits stdio, or the two compete for it.
  rl.close()

  const child = spawn('pnpm', ['db:seed', '--admin-only'], {
    cwd: WEB,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      JOMMA_ADMIN_EMAIL: email,
      JOMMA_ADMIN_PASSWORD: password,
      /*
       * The seed refuses outright when this is `production`, and a deployed
       * instance's own environment usually says exactly that. The check it
       * cares about is `--admin-only` plus where the data is going, both of
       * which are already satisfied — see the comment at the top of seed.ts.
       */
      NODE_ENV: 'development',
    },
  })

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`
  Signed-out next steps, in order:

    1. Accounts — pair a phone, then pick the SIM you are paid on.
    2. Apps     — create an app and a live API key.
    3. Apps     — add a webhook endpoint, and register your store's hostname
                  under Hosted checkout, or return redirects will not happen.
`)
    }
    process.exit(code ?? 1)
  })
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`)
  process.exit(1)
})
