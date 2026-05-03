import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/services/rpc';

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
  // listmyassets(verbose) returns an object keyed by address:
  // { address1: { assetInfo: { assetId: ..., restrictionType: ..., verifier: ... }, balance: ... }, ... }
  const data = await rpc.raw<Record<string, unknown>>('listmyassets', ['', true]);
  const assets: RestrictedAsset[] = [];
  for (const addressObj of Object.values(data)) {
    const addr = addressObj as Record<string, unknown>;
    // Each address entry has asset info records keyed by asset label
    for (const assetEntry of Object.values(addr)) {
      const info = assetEntry as Record<string, unknown>;
      const assetInfo = (info.assetInfo ?? info) as Record<string, unknown>;
      const restrictionType = String(assetInfo.restrictionType ?? 'none');
      if (restrictionType !== 'none') {
        assets.push({
          assetId: String(assetInfo.assetId ?? ''),
          assetLabel: String(assetInfo.assetLabel ?? ''),
          restrictionType,
          verifier: String(assetInfo.verifier ?? ''),
          balance: Number(info.balance ?? assetInfo.balance ?? 0),
        });
      }
    }
  }
  return assets;
}

/** Fetch qualifiers owned by the wallet */
async function fetchQualifiers(): Promise<Qualifier[]> {
  // Qualifiers appear as restricted assets with restrictionType containing 'QUALIFIER'
  // in listmyassets. Fetch from listmyassets and filter for QUALIFIER types.
  const data = await rpc.raw<Record<string, unknown>>('listmyassets', ['', true]);
  const qualifiers: Qualifier[] = [];
  for (const addressObj of Object.values(data)) {
    const addr = addressObj as Record<string, unknown>;
    for (const assetEntry of Object.values(addr)) {
      const info = assetEntry as Record<string, unknown>;
      const assetInfo = (info.assetInfo ?? info) as Record<string, unknown>;
      const restrictionType = String(assetInfo.restrictionType ?? 'none');
      if (restrictionType.toUpperCase().includes('QUALIFIER')) {
        const qualifierStr = String(assetInfo.assetLabel ?? assetInfo.assetId ?? '');
        if (qualifierStr && !qualifiers.find((q) => q.qualifier === qualifierStr)) {
          qualifiers.push({
            qualifier: qualifierStr,
            txid: String((assetInfo as any).assetTx ?? (info as any).assetTx ?? ''),
          });
        }
      }
    }
  }
  return qualifiers;
}

/** Fetch address tags */
async function fetchAddressTags(): Promise<AddressTag[]> {
  // The daemon has listtagsforaddress(address) and listaddressesfortag(tag) RPCs,
  // but there is no "list all tags" RPC. We would need wallet addresses first
  // (via listreceivedbyaddress) and then call listtagsforaddress for each one.
  // For now, stubbed as empty array.
  return [];
}

/** Fetch frozen/restricted addresses */
async function fetchAddressRestrictions(): Promise<AddressRestriction[]> {
  // The daemon has listaddressrestrictions(address) RPC, but we don't know
  // addresses a priori. We could get addresses from listreceivedbyaddress and
  // then call listaddressrestrictions for each one, but that's expensive.
  // listreceivedbyaddress returns {address, amount, confirmations, label, txids}
  // which does NOT include assetId, assetLabel, or status fields. Stubbing
  // to return empty array until we have a proper way to enumerate restrictions.
  return [];
}

/** Hook for restricted assets */
export function useRestrictedAssets() {
  return useQuery({
    queryKey: ['restrictedAssets'],
    queryFn: fetchRestrictedAssets,
    staleTime: 30_000,
  });
}

/** Hook for qualifiers */
export function useQualifiers() {
  return useQuery({
    queryKey: ['qualifiers'],
    queryFn: fetchQualifiers,
    staleTime: 60_000,
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
