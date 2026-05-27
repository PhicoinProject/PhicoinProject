import { useWalletHDKeyStore } from '@/stores/hdKeyStore';
import {
  deriveReceiveAddress,
  deriveChangeAddress,
  isValidPHICoinAddress,
} from './addressDerivation';
import { receivePath as canonicalReceivePath, getCoinType } from './HDWallet';
import { rpc } from './rpc';
import type { DerivedAddress } from '@/types';

// Default gap limit - stop scanning after this many consecutive unused addresses
const GAP_LIMIT = 10;

// Default pool size - number of pre-generated addresses
const POOL_SIZE = 10;

/**
 * Track derived addresses and their usage status.
 * Keys are BIP32 derivation paths, values contain usage state.
 */
export interface AddressRecord {
  address: string;
  path: string;
  isChange: boolean;
  index: number;
  used: boolean;
  lastSeen?: number; // block height when first used
}

/**
 * Address tracking service - manages HD wallet address pool and scans for usage.
 */
export class AddressTracker {
  private receiveUsed: number = 0;
  private changeUsed: number = 0;
  private records: Map<string, AddressRecord> = new Map();

  /** Initialize tracker by scanning existing addresses */
  async initialize(network: 'mainnet' | 'testnet'): Promise<void> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return;

    // Load previously scanned state from sessionStorage (ephemeral)
    this.loadState();

    // Scan for newly used addresses in the pool
    await this.scanForUsage(network);

    // Ensure we have enough unused addresses
    await this.replenishPool(network);
  }

  /** Get next unused receive address */
  getNextReceiveAddress(network: 'mainnet' | 'testnet'): DerivedAddress | null {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return null;

    const addr = deriveReceiveAddress(hdKey, network, this.receiveUsed);
    this.addRecord(addr, false);
    return addr;
  }

  /** Get next unused change address */
  getNextChangeAddress(network: 'mainnet' | 'testnet'): DerivedAddress | null {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return null;

    const addr = deriveChangeAddress(hdKey, network, this.changeUsed);
    this.addRecord(addr, false);
    return addr;
  }

  /** Get all derived addresses */
  getAllAddresses(): AddressRecord[] {
    return Array.from(this.records.values());
  }

  /** Get unused receive address pool */
  getUnusedPool(): DerivedAddress[] {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return [];

    const unused: DerivedAddress[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const index = this.receiveUsed + i;
      const path = this.receivePath(index);
      if (!this.records.has(path) || !this.records.get(path)?.used) {
        const hdKey = useWalletHDKeyStore.getState().hdKey;
        if (hdKey) {
          const net = this.getNetwork();
          unused.push(deriveReceiveAddress(hdKey, net, index));
        }
      }
    }
    return unused;
  }

  /**
   * Scan blockchain for address usage.
   * Uses z_getaddresstxids (address-index) to check each derived address
   * for transaction activity instead of wallet-bound listtransactions.
   */
  async scanForUsage(_network: 'mainnet' | 'testnet'): Promise<void> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return;

    try {
      // Collect all tracked addresses
      const trackedAddresses = Array.from(this.records.values()).map((r) => r.address);
      if (!trackedAddresses.length) return;

      // Build a set of addresses that have transaction activity
      const usedAddresses = new Set<string>();

      for (const addr of trackedAddresses) {
        try {
          const txIds = await rpc.getAddressTxIds(addr);
          if (txIds.length > 0) {
            usedAddresses.add(addr);
          }
        } catch {
          // Skip addresses that fail to query
        }
      }

      // Mark addresses as used if they have transaction activity
      for (const [, record] of this.records) {
        if (usedAddresses.has(record.address)) {
          record.used = true;
        }
      }

      // Update used counts
      this.updateUsedCounts();
      this.saveState();
    } catch {
      // If RPC is unavailable, use stored state
    }
  }

  /** Replenish the address pool to ensure enough unused addresses */
  private async replenishPool(network: 'mainnet' | 'testnet'): Promise<void> {
    const hdKey = useWalletHDKeyStore.getState().hdKey;
    if (!hdKey) return;

    const unusedReceiveCount = this.getUnusedReceiveCount();
    if (unusedReceiveCount < POOL_SIZE) {
      // Pre-generate more addresses (just adds to tracking, doesn't use RPC)
      for (let i = 0; i < POOL_SIZE - unusedReceiveCount; i++) {
        const nextIndex = this.receiveUsed + unusedReceiveCount + i + 1;
        const addr = deriveReceiveAddress(hdKey, network, nextIndex);
        this.addRecord(addr, false);
      }
      this.saveState();
    }
  }

  /** Mark an address as used (called after sending/receiving) */
  markAddressUsed(address: string): void {
    for (const [, record] of this.records) {
      if (record.address === address && !record.used) {
        record.used = true;
        this.updateUsedCounts();
        this.saveState();
        return;
      }
    }
  }

  /** Check if a PHICOIN address belongs to this wallet */
  isMyAddress(address: string): boolean {
    return Array.from(this.records.values()).some((r) => r.address === address);
  }

  /** Check if an address is valid PHICOIN address */
  isValidAddress(address: string): boolean {
    return isValidPHICoinAddress(address);
  }

  /** Get count of used receive addresses */
  getReceiveUsedCount(): number {
    return this.receiveUsed;
  }

  /** Get count of used change addresses */
  getChangeUsedCount(): number {
    return this.changeUsed;
  }

  /** Get gap limit */
  getGapLimit(): number {
    return GAP_LIMIT;
  }

  /** Reset tracker state */
  reset(): void {
    this.receiveUsed = 0;
    this.changeUsed = 0;
    this.records.clear();
    sessionStorage.removeItem('phi:addressTracker');
  }

  private addRecord(addr: DerivedAddress, used: boolean): void {
    this.records.set(addr.path, {
      address: addr.address,
      path: addr.path,
      isChange: addr.isChange,
      index: addr.index,
      used,
    });
  }

  private receivePath(index: number): string {
    // Canonical PHICOIN receive path m/44'/coinType'/0'/0/index (coinType=0 mainnet).
    return canonicalReceivePath(getCoinType(this.getNetwork()), index);
  }

  private getNetwork(): 'mainnet' | 'testnet' {
    return 'mainnet';
  }

  private getUnusedReceiveCount(): number {
    let count = 0;
    for (const [, record] of this.records) {
      if (!record.isChange && !record.used) {
        count++;
      }
    }
    return count;
  }

  private updateUsedCounts(): void {
    this.receiveUsed = 0;
    this.changeUsed = 0;

    for (const [, record] of this.records) {
      if (record.used) {
        if (!record.isChange) {
          this.receiveUsed = Math.max(this.receiveUsed, record.index + 1);
        } else {
          this.changeUsed = Math.max(this.changeUsed, record.index + 1);
        }
      }
    }
  }

  private saveState(): void {
    const state = {
      receiveUsed: this.receiveUsed,
      changeUsed: this.changeUsed,
      records: Array.from(this.records.entries()).map(([k, v]) => [k, v]),
    };
    sessionStorage.setItem('phi:addressTracker', JSON.stringify(state));
  }

  private loadState(): void {
    const saved = sessionStorage.getItem('phi:addressTracker');
    if (!saved) return;

    try {
      const state = JSON.parse(saved) as {
        receiveUsed: number;
        changeUsed: number;
        records: [string, AddressRecord][];
      };
      this.receiveUsed = state.receiveUsed;
      this.changeUsed = state.changeUsed;
      this.records = new Map(state.records);
    } catch {
      // Ignore corrupted state
    }
  }
}

export const addressTracker = new AddressTracker();
