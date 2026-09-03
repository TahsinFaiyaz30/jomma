/**
 * Normalisation. Pure, no I/O.
 *
 * Buyers type reference codes into a free-text field on a phone keypad. They add
 * spaces, hyphens, hashes, and the word "ref". Normalise hard before comparing:
 * uppercase, then strip everything that is not a letter or a digit.
 */

export function normalizeRef(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized.length > 0 ? normalized : null
}

/**
 * Bangladeshi msisdns arrive as `8801712345678`, `01712345678`, `+8801712345678`
 * and occasionally with spaces. The last ten digits are the stable part: the
 * operator prefix plus the subscriber number.
 */
export function normalizeMsisdn(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

/** Both must be present. A missing number is not a match, it is no information. */
export function sameMsisdn(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeMsisdn(a)
  const right = normalizeMsisdn(b)
  return left !== null && right !== null && left === right
}

/**
 * Levenshtein distance, bounded.
 *
 * Only distance 0 and 1 change any decision, so the search abandons a row as
 * soon as every cell in it exceeds `max`. That turns the worst case from
 * O(n·m) into O(n·max) and, more usefully, means a garbage 200-character
 * "reference" cannot slow down matching.
 */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let rowMin = current[0] as number

    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1)
      const deletion = (previous[j] as number) + 1
      const insertion = (current[j - 1] as number) + 1
      const value = Math.min(substitution, deletion, insertion)
      current[j] = value
      if (value < rowMin) rowMin = value
    }

    if (rowMin > max) return max + 1

    const swap = previous
    previous = current
    current = swap
  }

  return previous[b.length] as number
}

/** True when the two codes differ by exactly one edit. */
export function isFuzzyRefMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return levenshtein(a, b, 1) === 1
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60_000
}
