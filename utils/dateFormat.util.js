/**
 * Centralized Date-Time Formatting Utility
 * -----------------------------------------
 * Timezone  : Asia/Kolkata (IST, UTC+5:30)
 * Format    : 03 Jun 2026, 07:14 AM
 * Null/invalid → "N/A"
 * Never shows "Invalid Date"
 *
 * Usage (server-side / EJS):
 *   import { formatDate, formatDateShort, formatDateOnly } from '../utils/dateFormat.util.js';
 *   formatDate(order.createdAt)          → "03 Jun 2026, 07:14 AM"
 *   formatDateShort(order.createdAt)     → "03 Jun 2026"
 *   formatDateOnly(order.createdAt)      → "03 Jun"
 *   formatDateFull(order.createdAt)      → "03 June 2026, 07:14 AM"
 *   formatRelativeDay(order.createdAt)   → "Today" | "Yesterday" | "03 Jun 2026"
 */

const TIMEZONE = 'Asia/Kolkata';
const LOCALE   = 'en-IN';

/**
 * Internal: safely converts any input to a valid Date.
 * Returns null if the input is invalid/null/undefined.
 */
function toSafeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Full format: "03 Jun 2026, 07:14 AM"
 * Used for: order timestamps, wallet transactions, refunds, cancellations
 */
export function formatDate(value) {
  const d = toSafeDate(value);
  if (!d) return 'N/A';
  return new Intl.DateTimeFormat(LOCALE, {
    day:      '2-digit',
    month:    'short',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
    timeZone: TIMEZONE,
  }).format(d);
}

/**
 * Date + time with long month: "03 June 2026, 07:14 AM"
 * Used for: order placed banner, invoice headers
 */
export function formatDateFull(value) {
  const d = toSafeDate(value);
  if (!d) return 'N/A';
  return new Intl.DateTimeFormat(LOCALE, {
    day:      '2-digit',
    month:    'long',
    year:     'numeric',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
    timeZone: TIMEZONE,
  }).format(d);
}

/**
 * Date only: "03 Jun 2026"
 * Used for: order cards, order history list, report tables
 */
export function formatDateShort(value) {
  const d = toSafeDate(value);
  if (!d) return 'N/A';
  return new Intl.DateTimeFormat(LOCALE, {
    day:      '2-digit',
    month:    'short',
    year:     'numeric',
    timeZone: TIMEZONE,
  }).format(d);
}

/**
 * Day + month only: "03 Jun"
 * Used for: timeline steps, delivery tracking
 */
export function formatDateOnly(value) {
  const d = toSafeDate(value);
  if (!d) return 'N/A';
  return new Intl.DateTimeFormat(LOCALE, {
    day:      '2-digit',
    month:    'short',
    timeZone: TIMEZONE,
  }).format(d);
}

/**
 * Relative day: "Today" | "Yesterday" | "03 Jun 2026"
 * Used for: wallet transaction grouping
 */
export function formatRelativeDay(value) {
  const d = toSafeDate(value);
  if (!d) return 'N/A';

  const now = new Date();
  // Convert both to IST date strings for comparison
  const opts = { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' };
  const todayStr    = new Intl.DateTimeFormat('en-CA', opts).format(now); // YYYY-MM-DD
  const inputStr    = new Intl.DateTimeFormat('en-CA', opts).format(d);

  const todayDate     = new Date(todayStr);
  const yesterdayDate = new Date(todayStr);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const inputDate     = new Date(inputStr);

  if (inputDate.getTime() === todayDate.getTime())     return 'Today';
  if (inputDate.getTime() === yesterdayDate.getTime()) return 'Yesterday';
  return formatDateShort(value);
}

/**
 * ISO string safe: returns ISO string or null
 * Used for: export data, API responses
 */
export function toISOSafe(value) {
  const d = toSafeDate(value);
  return d ? d.toISOString() : null;
}

/**
 * Default export: all formatters as a single object
 * Useful for passing to EJS via res.locals
 */
export default {
  formatDate,
  formatDateFull,
  formatDateShort,
  formatDateOnly,
  formatRelativeDay,
  toISOSafe,
};
