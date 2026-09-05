#!/usr/bin/env node
/**
 * The version, in one place.
 *
 *   node scripts/version.mjs           print the current version
 *   node scripts/version.mjs --check   fail if anything has drifted (CI)
 *   node scripts/version.mjs 1.2.0     set it everywhere
 *   node scripts/version.mjs minor     bump it everywhere
 *
 * `VERSION` at the repository root is the source of truth. Every package.json
 * and the Android build read from it, because they ship together: a phone
 * reporting one version to a server running another is a support conversation
 * nobody can win. Before this, five package.json files said 0.1.0 while the app
 * said 1.0.0 and neither was true.
 *
 * The Android side does not appear below — `app/build.gradle.kts` reads VERSION
 * directly, so there is nothing to keep in sync there.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION_FILE = join(ROOT, 'VERSION')

/** Every package.json that must agree with VERSION. */
const PACKAGES = [
  'package.json',
  'apps/web/package.json',
  'apps/worker/package.json',
  'packages/shared/package.json',
  'packages/sdk/package.json',
]

/**
 * Plain `major.minor.patch`, optionally with a pre-release suffix.
 *
 * Minor and patch are capped below 100 because the Android version code packs
 * them as `major * 10000 + minor * 100 + patch`. At 100 they would carry into
 * the next field and the code would stop increasing with the version — Android
 * then refuses the build as a downgrade, on a phone, silently.
 */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/

function parse(version) {
  const match = SEMVER.exec(version)
  if (!match) throw new Error(`Not a version: ${JSON.stringify(version)}. Expected 1.2.3.`)

  const [, major, minor, patch, pre] = match
  if (Number(minor) > 99 || Number(patch) > 99) {
    throw new Error(
      `${version} would break the Android version code: minor and patch must stay below 100. ` +
        'Bump the field above instead.',
    )
  }
  return { major: Number(major), minor: Number(minor), patch: Number(patch), pre: pre ?? '' }
}

const read = (file) => readFileSync(join(ROOT, file), 'utf8')
const current = () => read('VERSION').trim()

function bump(version, kind) {
  const { major, minor, patch } = parse(version)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function write(version) {
  parse(version)
  writeFileSync(VERSION_FILE, `${version}\n`)

  for (const file of PACKAGES) {
    const text = read(file)
    // Rewritten textually rather than through JSON.stringify so key order,
    // indentation and the trailing newline survive — a version bump should not
    // show up as a whole-file diff.
    const next = text.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`)
    if (next === text) throw new Error(`No "version" field to update in ${file}.`)
    writeFileSync(join(ROOT, file), next)
  }

  return version
}

function check() {
  const version = current()
  parse(version)

  const drifted = PACKAGES.filter((file) => JSON.parse(read(file)).version !== version)

  if (drifted.length > 0) {
    console.error(
      `VERSION says ${version} but these disagree:\n` +
        drifted.map((f) => `  ${f}: ${JSON.parse(read(f)).version}`).join('\n') +
        '\n\nRun: pnpm version:set ' +
        version,
    )
    process.exit(1)
  }

  console.log(`${version} — consistent across ${PACKAGES.length} packages`)
}

const arg = process.argv[2]

try {
  if (!arg) console.log(current())
  else if (arg === '--check') check()
  else if (['major', 'minor', 'patch'].includes(arg)) console.log(write(bump(current(), arg)))
  else console.log(write(arg))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
