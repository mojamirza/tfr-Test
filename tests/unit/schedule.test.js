/**
 * Unit tests for the local scheduler queue's time math.
 */
import { describe, it, expect } from 'vitest';
import { parseScheduleDateTime, isDue, MIN_AHEAD_SECONDS } from '../../src/shared/schedule.js';

/** A fixed reference moment: 2026-10-25 12:00:00 local. */
const NOW = new Date('2026-10-25T12:00:00').getTime();

describe('parseScheduleDateTime', () => {
  it('turns a future date-time into whole Unix seconds', () => {
    const result = parseScheduleDateTime('2026-10-25', '15:30', NOW);
    expect(result.ok).toBe(true);
    expect(result.at).toBe(Math.floor(new Date('2026-10-25T15:30:00').getTime() / 1000));
  });

  it('rejects an empty field as incomplete', () => {
    expect(parseScheduleDateTime('', '15:30', NOW)).toEqual({ ok: false, reason: 'incomplete' });
    expect(parseScheduleDateTime('2026-10-25', '', NOW)).toEqual({ ok: false, reason: 'incomplete' });
  });

  it('rejects a malformed field as invalid', () => {
    expect(parseScheduleDateTime('not-a-date', '15:30', NOW).reason).toBe('invalid');
    expect(parseScheduleDateTime('2026-10-25', '25:99', NOW).reason).toBe('invalid');
  });

  it('rejects a moment inside the lead window as past', () => {
    // Half a minute ahead is under the 60-second lead.
    expect(parseScheduleDateTime('2026-10-25', '12:00:30', NOW).reason).toBe('past');
    // Yesterday, far in the past.
    expect(parseScheduleDateTime('2026-10-24', '09:00', NOW).reason).toBe('past');
  });

  it('accepts a moment just beyond the lead window', () => {
    const result = parseScheduleDateTime('2026-10-25', '12:02', NOW);
    expect(result.ok).toBe(true);
    expect(result.at * 1000 - NOW).toBeGreaterThanOrEqual(MIN_AHEAD_SECONDS * 1000);
  });
});

describe('isDue', () => {
  it('fires at the due second and after, not before', () => {
    const entry = { at: 1769362800 }; // some fixed second
    const at = entry.at * 1000;
    expect(isDue(entry, at - 1)).toBe(false);
    expect(isDue(entry, at)).toBe(true);
    expect(isDue(entry, at + 15000)).toBe(true);
  });
});
