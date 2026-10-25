/**
 * Schedule — the local scheduler queue's time math.
 *
 * The Bot API carries no server-side scheduling for bots (no `schedule_date`
 * on any send method through API 10.3), so the app queues the pre-computed
 * requests itself and fires them at the due moment. This module owns the
 * date-time parsing and validation the queue depends on.
 *
 * @module shared/schedule
 */

/** A due time must sit at least this far in the future, in seconds. */
export const MIN_AHEAD_SECONDS = 60;

/**
 * Turn the scheduler dialog's two fields into a due timestamp.
 *
 * Both fields come from their native pickers as `YYYY-MM-DD` and `HH:MM`
 * (local wall-clock time, never UTC), so a plain combined ISO parse is
 * the correct reading.
 *
 * @param {string} dateStr The date field, `YYYY-MM-DD`.
 * @param {string} timeStr The time field, `HH:MM`.
 * @param {number} [now] The reference "current" moment, ms — injectable for tests.
 * @returns {{ ok: true, at: number } | { ok: false, reason: 'incomplete' | 'invalid' | 'past' }}
 *   `at` is the due moment as whole Unix seconds, the unit every Bot API
 *   timestamp travels in.
 */
export function parseScheduleDateTime(dateStr, timeStr, now = Date.now()) {
  if (!dateStr || !timeStr) return { ok: false, reason: 'incomplete' };
  const due = new Date(`${dateStr}T${timeStr}`);
  const ms = due.getTime();
  if (Number.isNaN(ms)) return { ok: false, reason: 'invalid' };
  const at = Math.floor(ms / 1000);
  if (at * 1000 < now + MIN_AHEAD_SECONDS * 1000) return { ok: false, reason: 'past' };
  return { ok: true, at };
}

/**
 * True when a queue entry is due — the fire loop's predicate. Entries are
 * fired slightly late-rather-early: a clock skews forward, a send does not.
 * @param {{ at: number }} entry
 * @param {number} [nowMs]
 */
export function isDue(entry, nowMs = Date.now()) {
  return entry.at * 1000 <= nowMs;
}
