/**
 * Browser Notification API wrapper for wallet transaction alerts.
 *
 * Requests permission on first user interaction and emits
 * native desktop notifications for incoming/outgoing transactions.
 */

export type NotificationPermission = 'default' | 'granted' | 'denied';

/**
 * Get the current notification permission status.
 */
export function getNotificationPermission(): NotificationPermission {
  if (!('Notification' in window)) {
    return 'denied'; // Browser does not support notifications
  }
  return Notification.permission;
}

/**
 * Request notification permission from the user.
 * Returns the resulting permission status.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  const permission = await Notification.requestPermission();
  return permission;
}

/**
 * Check if the browser supports the Notification API.
 */
export function isNotificationSupported(): boolean {
  return 'Notification' in window;
}

/**
 * Show a notification for a wallet event.
 * Only fires if permission has been granted.
 */
export function showNotification(options: {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
}): void {
  if (!isNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;

  try {
    const opts: NotificationOptions = {
      body: options.body,
      icon: options.icon ?? '/favicon.ico',
    };

    if (options.tag) {
      new Notification(options.title, { ...opts, tag: options.tag });
    } else {
      new Notification(options.title, opts);
    }
  } catch {
    // Silently fail if the browser blocks the notification (e.g. visibility change)
  }
}

/**
 * Notify on a new incoming transaction.
 */
export function notifyIncomingTransaction(txid: string, amount: number, confirmations = 0): void {
  showNotification({
    title: 'PHICOIN - Incoming Transaction',
    body: `Received ${amount.toFixed(8)} PHI (${txid.slice(0, 8)}...) — ${confirmations} confirmation${confirmations !== 1 ? 's' : ''}`,
    tag: `tx-${txid}`,
  });
}

/**
 * Notify on a new outgoing transaction.
 */
export function notifyOutgoingTransaction(txid: string, amount: number): void {
  showNotification({
    title: 'PHICOIN - Outgoing Transaction',
    body: `Sent ${amount.toFixed(8)} PHI (txid: ${txid.slice(0, 8)}...)`,
    tag: `tx-${txid}`,
  });
}

/**
 * Notify on a new block being mined.
 */
export function notifyNewBlock(height: number): void {
  showNotification({
    title: 'PHICOIN - New Block',
    body: `Block #${height} mined`,
    tag: `block-${height}`,
  });
}

// ---- In-app notification event system ----

/** Callback fired when a new wallet transaction is detected. */
export type NewTransactionCallback = (txIds: string[]) => void;

/** Callback fired when a new block is detected. */
export type NewBlockCallback = (blockHeight: number) => void;

/** Callback fired when balance changes. */
export type BalanceChangeCallback = (balance: number) => void;

/**
 * Notification manager that detects changes in mempool txs, block height,
 * and wallet balance, firing registered callbacks on each change.
 *
 * This is a stateful singleton so that hooks can register listeners without
 * creating competing interval timers.
 */
class NotificationManager {
  private newTxListeners = new Set<NewTransactionCallback>();
  private newBlockListeners = new Set<NewBlockCallback>();
  private balanceChangeListeners = new Set<BalanceChangeCallback>();

  private lastMempoolTxIds = new Set<string>();
  private lastBlockHeight = 0;
  private lastBalance = -1;

  /** Register a callback for new wallet transactions. Returns an unsubscribe fn. */
  onNewTransaction(fn: NewTransactionCallback): () => void {
    this.newTxListeners.add(fn);
    return () => this.newTxListeners.delete(fn);
  }

  /** Register a callback for new blocks. Returns an unsubscribe fn. */
  onNewBlock(fn: NewBlockCallback): () => void {
    this.newBlockListeners.add(fn);
    return () => this.newBlockListeners.delete(fn);
  }

  /** Register a callback for balance changes. Returns an unsubscribe fn. */
  onBalanceChange(fn: BalanceChangeCallback): () => void {
    this.balanceChangeListeners.add(fn);
    return () => this.balanceChangeListeners.delete(fn);
  }

  /**
   * Process a mempool snapshot: detect new tx IDs not seen before
   * and fire new-transaction callbacks.
   */
  processMempool(txIds: string[]): void {
    const currentTxIds = new Set(txIds);
    const newTxs: string[] = [];

    for (const txId of currentTxIds) {
      if (!this.lastMempoolTxIds.has(txId)) {
        newTxs.push(txId);
      }
    }

    this.lastMempoolTxIds = currentTxIds;

    if (newTxs.length > 0) {
      for (const fn of this.newTxListeners) {
        fn(newTxs);
      }
    }
  }

  /**
   * Process a chain snapshot: detect new blocks and balance changes.
   */
  processSnapshot(blockHeight: number, balance: number, mempoolTxIds: string[]): void {
    // Check for new blocks
    if (blockHeight > this.lastBlockHeight) {
      this.lastBlockHeight = blockHeight;

      for (const fn of this.newBlockListeners) {
        fn(blockHeight);
      }
    } else if (blockHeight < this.lastBlockHeight) {
      // Potential reorg -- reset to current height
      this.lastBlockHeight = blockHeight;
    }

    // Check for balance changes (only after first valid read)
    if (this.lastBalance >= 0 && Math.abs(balance - this.lastBalance) > 1e-10) {
      for (const fn of this.balanceChangeListeners) {
        fn(balance);
      }
    }
    this.lastBalance = balance;

    // Also process mempool tx IDs
    this.processMempool(mempoolTxIds);
  }
}

/** Singleton instance shared across all hooks and components. */
export const notificationManager = new NotificationManager();
