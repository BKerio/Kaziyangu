/**
 * Centralised date/time handling for the EOC.
 *
 * All operations are pinned to Africa/Nairobi (UTC+3, no DST) so timestamps are
 * shown consistently regardless of the viewer's machine timezone. Previously many
 * screens called `new Date(x).toLocaleString(...)` without a timeZone, so times
 * rendered in the browser's local zone and appeared "2 hours behind".
 */
export const NBO_TZ = 'Africa/Nairobi';
export const NBO_OFFSET = '+03:00'; // Kenya has no daylight saving - fixed offset is safe

/** "12 Aug, 14:30" - the common short stamp used across list rows/timelines. */
export function fmtDateTime(value?: string | number | Date | null): string {
  const d = toDate(value);
  if (!d) return '-';
  return d.toLocaleString('en-GB', {
    timeZone: NBO_TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** "12 Aug 2026, 14:30" - with year, for detail views/exports. */
export function fmtDateTimeFull(value?: string | number | Date | null): string {
  const d = toDate(value);
  if (!d) return '-';
  return d.toLocaleString('en-GB', {
    timeZone: NBO_TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "12 Aug 2026" - date only. */
export function fmtDate(value?: string | number | Date | null): string {
  const d = toDate(value);
  if (!d) return '-';
  return d.toLocaleDateString('en-GB', { timeZone: NBO_TZ, day: '2-digit', month: 'short', year: 'numeric' });
}

/** "14:30:05" - clock time only. */
export function fmtTime(value?: string | number | Date | null, withSeconds = true): string {
  const d = toDate(value);
  if (!d) return '-';
  return d.toLocaleTimeString('en-GB', {
    timeZone: NBO_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

/**
 * Format an instant as a Nairobi wall-clock string for a <input type="datetime-local">,
 * e.g. "2026-08-12T14:30". Defaults to now.
 */
export function toNairobiInput(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NBO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Today's calendar date in Nairobi, as "YYYY-MM-DD" - defaults to now.
 * Deliberately timezone-anchored rather than using the viewer's machine
 * timezone: near a day boundary, `new Date().toISOString().slice(0, 10)`
 * (UTC) or plain `Date` getters (viewer-local) can each land on a different
 * calendar day than Nairobi's, which is the one that actually matters here.
 */
export function nairobiTodayISO(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NBO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Convert a Nairobi wall-clock datetime-local string ("2026-08-12T14:30") to a
 * UTC ISO instant. The value is interpreted as Nairobi time (+03:00).
 */
export function nairobiInputToISO(local?: string | null): string | undefined {
  if (!local) return undefined;
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  const d = new Date(`${withSeconds}${NBO_OFFSET}`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toDate(value?: string | number | Date | null): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}
