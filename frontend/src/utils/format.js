/** Formats a date-only value (a Postgres DATE column often arrives as an ISO datetime string
 *  at UTC midnight) as YYYY-MM-DD without a time component. */
export function formatDateOnly(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}
