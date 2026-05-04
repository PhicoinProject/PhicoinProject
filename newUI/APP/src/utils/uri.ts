/**
 * Parse a phicoin: URI into structured components.
 *
 * Supported format:
 *   phicoin:address?amount=X&label=Y&message=Z
 *
 * Based on BIP-21 convention adapted for PHICOIN.
 */
export interface PhiCoinUri {
  address: string;
  amount?: number;
  label?: string;
  message?: string;
}

/**
 * Parse "phicoin:address?amount=X&label=Y&message=Z" into a PhiCoinUri object.
 * Throws if the URI format is invalid.
 */
export function parsePhiCoinUri(uri: string): PhiCoinUri {
  const trimmed = uri.trim().toLowerCase();

  if (!trimmed.startsWith('phicoin:')) {
    throw new Error('Invalid PHICOIN URI: must start with "phicoin:"');
  }

  const [, rest] = trimmed.split('phicoin:', 2);
  if (!rest) {
    throw new Error('Invalid PHICOIN URI: missing address');
  }

  const [address, queryString] = rest.split('?', 2);

  if (!address || address.length < 10) {
    throw new Error('Invalid PHICOIN URI: address is too short');
  }

  const result: PhiCoinUri = { address: address.toUpperCase() };

  if (queryString) {
    try {
      const params = new URLSearchParams(queryString);
      for (const [key, value] of params.entries()) {
        switch (key.toLowerCase()) {
          case 'amount': {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0) {
              throw new Error('Invalid PHICOIN URI: amount must be a positive number');
            }
            result.amount = num;
            break;
          }
          case 'label':
            result.label = decodeURIComponent(value);
            break;
          case 'message':
            result.message = decodeURIComponent(value);
            break;
          default:
            // Ignore unknown parameters for forward compatibility
            break;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Invalid PHICOIN URI')) throw err;
      throw new Error('Invalid PHICOIN URI: could not parse query parameters');
    }
  }

  return result;
}

/**
 * Build a phicoin: URI from structured data.
 */
export function buildPhiCoinUri(params: {
  address: string;
  amount?: number;
  label?: string;
  message?: string;
}): string {
  const parts = [`phicoin:${params.address.toLowerCase()}`];
  const query = new URLSearchParams();

  if (params.amount !== undefined && params.amount > 0) {
    query.set('amount', params.amount.toString());
  }
  if (params.label) {
    query.set('label', params.label);
  }
  if (params.message) {
    query.set('message', params.message);
  }

  if (query.toString()) {
    parts.push(`?${query.toString()}`);
  }

  return parts.join('');
}

/**
 * Check if a string looks like a phicoin: URI.
 */
export function isPhiCoinUri(str: string): boolean {
  return str.trim().toLowerCase().startsWith('phicoin:');
}
