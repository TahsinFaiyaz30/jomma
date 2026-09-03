/**
 * Operational thresholds.
 *
 * Deliberately a leaf module with no imports. These values are needed on both
 * sides of the client boundary — the routing decision on the server, the health
 * colour in the sidebar footer — and putting them next to the account service
 * would drag `pg` into the browser bundle through one `import` of a constant.
 */

/** Warn at 80% of the daily limit. */
export const UTILIZATION_WARN = 0.8

/** Stop routing new intents at 95%, and fail over to the second account. */
export const UTILIZATION_STOP = 0.95

/** A heartbeat gap wider than this is critical. */
export const HEARTBEAT_GAP_ALERT_MINUTES = 15

/** No captures for this long during business hours is high severity. */
export const CAPTURE_SILENCE_ALERT_HOURS = 3

/** Manual queue items older than this are medium severity. */
export const QUEUE_STALE_HOURS = 2
