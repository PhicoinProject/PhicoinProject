import { create } from 'zustand';

interface AuthState {
  unlocked: boolean;
  walletExists: boolean;
  setUnlocked: (v: boolean) => void;
  setWalletExists: (v: boolean) => void;
  reset: () => void;
}

const initial = {
  unlocked: false,
  walletExists: false,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initial,
  setUnlocked: (v) => set(() => ({ unlocked: v })),
  setWalletExists: (v) => set(() => ({ walletExists: v })),
  reset: () => set(() => initial),
}));
