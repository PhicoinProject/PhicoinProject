import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/services/rpc';
import { walletService } from '@/services/wallet';

/** Restricted asset detail */
export interface RestrictedAsset {
  assetId: string;
  assetLabel: string;
  restrictionType: string;
  verifier: string;
  balance: number;
}

/** Qualifier owned by the wallet */
export interface Qualifier {
  qualifier: string;
  txid: string;
}

/** Address tag */
export interface AddressTag {
  address: string;
  tag: string;
}

/** Address restriction (frozen) */
export interface AddressRestriction {
  address: string;
  assetId: string;
  assetLabel: string;
  status: string;
}

/** Fetch restricted assets held by the wallet */
async function fetchRestrictedAssets(): Promise<RestrictedAsset[]> {
  const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
  if (!addresses.length) return [];

  const assets: RestrictedAsset[] = [];
  const seen = new Set<string>();

  for (const addr of addresses) {
    try {
      const balances = await rpc.getAssetBalances(addr);
      // getAssetBalances returns a map { assetName: balance }. Some deployments
      // may return an array of entry objects; tolerate both shapes.
      const entries: Record<string, unknown>[] = Array.isArray(balances)
        ? (balances as unknown as Record<string, unknown>[])
        : Object.entries(balances || {}).map(([asset, balance]) => ({ asset, balance }));
      for (const entry of entries) {
        const assetId = String(entry.asset ?? entry.assetId ?? '');
        if (!assetId || seen.has(assetId)) continue;
        seen.add(assetId);

        const restrictionType = String(entry.restrictionType ?? 'none');
        if (restrictionType === 'none') continue;

        assets.push({
          assetId,
          assetLabel: assetId,
          restrictionType,
          verifier: String(entry.verifier ?? ''),
          balance: Number(entry.balance ?? entry.amount ?? 0),
        });
      }
    } catch {
      // Skip
    }
  }
  return assets;
}

/** Fetch qualifiers owned by the wallet */
async function fetchQualifiers(): Promise<Qualifier[]> {
  const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
  if (!addresses.length) return [];

  const qualifiers: Qualifier[] = [];
  const seen = new Set<string>();

  for (const addr of addresses) {
    try {
      const balances = await rpc.getAssetBalances(addr);
      const entries: Record<string, unknown>[] = Array.isArray(balances)
        ? (balances as unknown as Record<string, unknown>[])
        : Object.entries(balances || {}).map(([asset, balance]) => ({ asset, balance }));
      for (const entry of entries) {
        const assetId = String(entry.asset ?? entry.assetId ?? '');
        if (!assetId || seen.has(assetId)) continue;
        seen.add(assetId);

        const restrictionType = String(entry.restrictionType ?? 'none');
        if (!restrictionType.toUpperCase().includes('QUALIFIER')) continue;

        if (!qualifiers.find((q) => q.qualifier === assetId)) {
          qualifiers.push({
            qualifier: assetId,
            txid: String(entry.assetTx ?? entry.blockhash ?? ''),
          });
        }
      }
    } catch {
      // Skip
    }
  }
  return qualifiers;
}

/** Fetch address tags */
async function fetchAddressTags(): Promise<AddressTag[]> {
  // Requires wallet addresses + listtagsforaddress per address
  return [];
}

/** Fetch frozen/restricted addresses */
async function fetchAddressRestrictions(): Promise<AddressRestriction[]> {
  // Requires wallet addresses + listaddressrestrictions per address
  return [];
}

/** Hook for restricted assets */
export function useRestrictedAssets() {
  const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
  return useQuery({
    queryKey: ['restrictedAssets', addresses.join(',')],
    queryFn: fetchRestrictedAssets,
    staleTime: 30_000,
    enabled: addresses.length > 0,
  });
}

/** Hook for qualifiers */
export function useQualifiers() {
  const addresses = walletService.getDerivedAddressPool().map((a) => a.address);
  return useQuery({
    queryKey: ['qualifiers', addresses.join(',')],
    queryFn: fetchQualifiers,
    staleTime: 60_000,
    enabled: addresses.length > 0,
  });
}

/** Hook for address tags */
export function useAddressTags() {
  return useQuery({
    queryKey: ['addressTags'],
    queryFn: fetchAddressTags,
    staleTime: 30_000,
  });
}

/** Hook for address restrictions */
export function useAddressRestrictions() {
  return useQuery({
    queryKey: ['addressRestrictions'],
    queryFn: fetchAddressRestrictions,
    staleTime: 30_000,
  });
}
