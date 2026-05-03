import { create } from 'zustand';
import type { HDKey } from '@scure/bip32';

interface HDKeyStore {
  hdKey: HDKey | null;
  setHDKey: (key: HDKey) => void;
  clearHDKey: () => void;
  isUnlocked: () => boolean;
}

export const useWalletHDKeyStore = create<HDKeyStore>((set, get) => ({
  hdKey: null,
  setHDKey: (key: HDKey) => set(() => ({ hdKey: key })),
  clearHDKey: () => set(() => ({ hdKey: null })),
  isUnlocked: () => !!get().hdKey,
}));
