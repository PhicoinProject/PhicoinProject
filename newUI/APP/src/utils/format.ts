import { CONFIRMATION_TARGET, TRUNCATE_START, TRUNCATE_END, PHICOID_DECIMAL_PLACES } from './constants';

/** Format a number with locale-aware separators */
export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a raw PHI amount to human-readable string */
export function formatPhi(amount: number, decimals = PHICOID_DECIMAL_PLACES): string {
  return amount.toFixed(decimals).replace(/\.?0+$/, '');
}

/** Format a timestamp to a readable date string */
export function formatDate(unixTimestamp: number): string {
  if (!unixTimestamp) return '';
  const date = new Date(unixTimestamp * 1000);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format a timestamp to a relative time string (e.g. "2 hours ago") */
export function formatRelativeTime(unixTimestamp: number): string {
  if (!unixTimestamp) return '—';
  const now = Date.now() / 1000;
  const diff = now - unixTimestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

  return formatDate(unixTimestamp);
}

/** Truncate a string for display (e.g. txids) */
export function truncate(str: string, start = TRUNCATE_START, end = TRUNCATE_END): string {
  if (str.length <= start + end + 3) return str;
  return `${str.slice(0, start)}...${str.slice(-end)}`;
}

/** Format confirmation count with a label */
export function formatConfirmations(confirmations: number, target = CONFIRMATION_TARGET): string {
  if (confirmations <= 0) return 'Unconfirmed';
  if (confirmations < target) return `${confirmations}/${target}`;
  return 'Confirmed';
}

/** Format asset amount with precision */
export function formatAssetAmount(amount: number, precision: number): string {
  return (amount / 10 ** precision).toFixed(precision).replace(/\.?0+$/, '');
}
