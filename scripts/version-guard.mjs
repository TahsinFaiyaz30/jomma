#!/usr/bin/env node
/**
 * Refuses a push that ships code without moving the version.
 *
 *   node scripts/version-guard.mjs <before-sha> <after-sha>
 *
 * This exists because of a specific failure, not a hypothetical one. Nine
 * commits adding business tenancy, the device approval gate and multi-number
 * support went out with `VERSION` untouched. No tag followed, so the Release
 * workflow never ran and no APK was ever built for any of it — a phone
 * reporting 1.3.2 was running code that 1.3.2 had never contained, and the only
 * thing that would have noticed was somebody remembering.
 *
 * Remembering is not a mechanism. This is.
 *
 * Deliberately about *shippable* paths only. Documentation, workflows, the docs
 * site and scratch files change constantly and version nothing; what needs a
 * version is anything that lands on a phone, in the database, or in the API
 * contract. Being noisy about README edits is how a guard gets switched off.
 */

import { execFileSync } from 'node:child_process'

const [before, after] = process.argv.slice(2)

/** Paths whose contents are shipped to somebody. */
const SHIPPABLE = [
  /^apps\/android\/app\/src\//,
  /^apps\/android\/app\/build\.gradle\.kts$/,
  /^apps\/web\/(app|lib|components)\//,
  /^apps\/web\/drizzle\/[^/]+\.sql$/,
  /^apps\/worker\/src\//,
  /^packages\/(shared|sdk)\/src\//,
]

/**
 * A first push, a force-push, or a squash can leave `before` as the all-zero
 * sha or pointing at something no longer in the repository. Passing rather than
 * exploding is right: a guard that fails on its own bookkeeping teaches people
 * to ignore it.
 */
const ZERO = '0000000000000000000000000000000000000000'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

if (!before || !after || before === ZERO) {
  console.log('version-guard: no usable diff range — skipping.')
  process.exit(0)
}

let changed
try {
  changed = git('diff', '--name-only', `${before}..${after}`).split('\n').filter(Boolean)
} catch {
  console.log('version-guard: could not diff the range — skipping.')
  process.exit(0)
}

const shipped = changed.filter((f) => SHIPPABLE.some((r) => r.test(f)))

if (shipped.length === 0) {
  console.log('version-guard: nothing shippable changed.')
  process.exit(0)
}

const versionChanged = changed.includes('VERSION')

if (versionChanged) {
  console.log(`version-guard: ${shipped.length} shippable file(s) changed, and VERSION moved.`)
  process.exit(0)
}

const current = git('show', `${after}:VERSION`)

console.error(
  [
    '',
    `  ${shipped.length} shippable file(s) changed and VERSION did not move.`,
    '',
    `  Still ${current}. Whatever is in this push has no version of its own, so no`,
    '  tag can be cut for it and no APK will ever be built containing it.',
    '',
    '  Shipped in this range:',
    ...shipped.slice(0, 12).map((f) => `    ${f}`),
    ...(shipped.length > 12 ? [`    … and ${shipped.length - 12} more`] : []),
    '',
    '  Fix it:',
    '',
    '    pnpm version:set patch     # a fix',
    '    pnpm version:set minor     # a feature',
    '    git commit -am "Release x.y.z" && git push',
    '    git tag vx.y.z && git push origin vx.y.z',
    '',
  ].join('\n'),
)
process.exit(1)
