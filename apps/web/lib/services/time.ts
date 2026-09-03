/**
 * Bangladesh Standard Time is UTC+06:00 with no daylight saving, and has had
 * none since the 2009 experiment was abandoned. A fixed offset is therefore
 * correct here and avoids pulling a timezone database into hot paths.
 */
export const BST_OFFSET_MINUTES = 6 * 60

/** Midnight in Dhaka, as a UTC instant. */
export function startOfBusinessDay(reference: Date = new Date()): Date {
  const shifted = new Date(reference.getTime() + BST_OFFSET_MINUTES * 60_000)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - BST_OFFSET_MINUTES * 60_000)
}

/** First instant of the current month in Dhaka, as a UTC instant. */
export function startOfBusinessMonth(reference: Date = new Date()): Date {
  const shifted = new Date(reference.getTime() + BST_OFFSET_MINUTES * 60_000)
  shifted.setUTCDate(1)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - BST_OFFSET_MINUTES * 60_000)
}

/** 09:00–22:00 Dhaka. Used by the "no captures for 3 hours" alert. */
export function isBusinessHours(reference: Date = new Date()): boolean {
  const hour = new Date(reference.getTime() + BST_OFFSET_MINUTES * 60_000).getUTCHours()
  return hour >= 9 && hour < 22
}

export function secondsFromNow(seconds: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + seconds * 1000)
}

export function minutesAgo(minutes: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - minutes * 60_000)
}
