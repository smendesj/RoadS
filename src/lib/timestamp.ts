// An ISO-8601 timestamp with an explicit offset ("...Z" or "+00:00"), the shape the queue API
// hands out and takes back. Anything looser (a bare year, a date, no offset) would pass Date.parse
// and still fail inside Postgres, turning bad input into a 500.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value));
}

// True when `iso` is a moment in the past less than `windowMs` before `now` (a future or invalid
// timestamp never counts as recent).
export function isWithin(iso: string, now: number, windowMs: number): boolean {
  const then = Date.parse(iso);
  return !Number.isNaN(then) && then <= now && now - then < windowMs;
}
