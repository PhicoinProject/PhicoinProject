import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** An entry in the local address book */
export interface AddressBookEntry {
  id: string;
  address: string;
  label: string;
  type: 'sending' | 'receiving';
  createdAt: number;
}

interface AddressBookState {
  entries: AddressBookEntry[];
}

interface AddressBookActions {
  addEntry: (entry: Omit<AddressBookEntry, 'id' | 'createdAt'>) => string;
  updateLabel: (id: string, label: string) => void;
  deleteEntry: (id: string) => void;
  findByAddress: (address: string) => AddressBookEntry | undefined;
  findByLabel: (label: string) => AddressBookEntry | undefined;
  getEntries: (type?: 'sending' | 'receiving') => AddressBookEntry[];
  clearAll: () => void;
}

export const useAddressBookStore = create<AddressBookState & AddressBookActions>()(
  persist(
    (set, get) => ({
      entries: [],

      addEntry: ({ address, label, type }) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const entry: AddressBookEntry = {
          id,
          address,
          label,
          type,
          createdAt: Date.now(),
        };
        set((state) => ({ entries: [...state.entries, entry] }));
        return id;
      },

      updateLabel: (id, label) =>
        set((state) => ({
          entries: state.entries.map((e) => (e.id === id ? { ...e, label } : e)),
        })),

      deleteEntry: (id) =>
        set((state) => ({
          entries: state.entries.filter((e) => e.id !== id),
        })),

      findByAddress: (address) => {
        const lower = address.toLowerCase();
        return get().entries.find((e) => e.address.toLowerCase() === lower);
      },

      findByLabel: (label) => {
        const lower = label.toLowerCase();
        return get().entries.find((e) => e.label.toLowerCase() === lower);
      },

      getEntries: (type) => {
        if (type) {
          return get().entries.filter((e) => e.type === type);
        }
        return get().entries;
      },

      clearAll: () => set({ entries: [] }),
    }),
    {
      name: 'phicoin-addressbook', // localStorage key
      version: 1,
    }
  )
);
