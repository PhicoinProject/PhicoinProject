import { create } from 'zustand';
import type { HDKey } from '@scure/bip32';

interface HDKeyStore {
  hdKey: HDKey | null;
  setHDKey: (key: HDKey) => void;
  clearHDKey: () => void;
  isUnlocked: () => boolean;
}

/**
 * Zeroize and clear the HDKey from memory, then set the store to null.
 * Overwrites private key material with zeros before releasing the reference
 * to reduce the window where key material could be recovered from memory dumps.
 */
function zeroizeHdKey(key: HDKey | null) {
  if (!key) return;
  try {
    if (key.privateKey) key.privateKey.fill(0);
    if (key.publicKey) key.publicKey.fill(0);
    if (key.chainCode) key.chainCode.fill(0);
  } catch {
    // Some implementations may throw on fill(0) — ignore and proceed
  }
}

export const useWalletHDKeyStore = create<HDKeyStore>((set, get) => ({
  hdKey: null,
  setHDKey: (key: HDKey) => set(() => ({ hdKey: key })),
  clearHDKey: () => {
    const current = get().hdKey;
    zeroizeHdKey(current);
    set(() => ({ hdKey: null }));
  },
  isUnlocked: () => !!get().hdKey,
}));
