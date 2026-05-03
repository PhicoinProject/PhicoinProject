import { create } from 'zustand';
import type { WalletState } from '@/types';

const initialState: WalletState = {
  unlocked: false,
  walletName: '',
  balances: {},
  phiBalance: 0,
  addresses: [],
  currentAddress: '',
  network: 'mainnet',
  syncStatus: {
    blocks: 0,
    headers: 0,
    synced: false,
  },
  lastBlockHeight: 0,
  error: null,
};

interface WalletStore extends WalletState {
  setWalletState: (state: Partial<WalletState>) => void;
  setBalance: (balance: number) => void;
  setSyncStatus: (status: WalletState['syncStatus']) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useWalletStore = create<WalletStore>((set) => ({
  ...initialState,

  setWalletState: (partial) => set(() => ({ ...partial })),

  setBalance: (phiBalance) => set(() => ({ phiBalance })),

  setSyncStatus: (syncStatus) => set(() => ({ syncStatus })),

  setError: (error) => set(() => ({ error })),

  reset: () => set(() => initialState),
}));
