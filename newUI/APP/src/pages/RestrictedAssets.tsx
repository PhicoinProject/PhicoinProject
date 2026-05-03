import { useState } from 'react';
import {
  useRestrictedAssets,
  useQualifiers,
  useAddressTags,
  useAddressRestrictions,
} from '@/hooks';
import type {
  RestrictedAsset,
  Qualifier,
  AddressTag,
  AddressRestriction,
} from '@/hooks/useRestrictedAssets';

/** Restricted Assets page — manage restricted assets, qualifiers, tags, and address restrictions */
export const RestrictedAssets: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'my-restricted' | 'qualifiers' | 'tags' | 'restrictions'
  >('my-restricted');

  const { data: restrictedAssets, isLoading: restrictedLoading } = useRestrictedAssets();
  const { data: qualifiers, isLoading: qualifiersLoading } = useQualifiers();
  const { data: tags, isLoading: tagsLoading } = useAddressTags();
  const { data: restrictions, isLoading: restrictionsLoading } = useAddressRestrictions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-dark-text">Restricted Assets</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-200 dark:bg-dark-elevated p-1">
        {[
          { key: 'my-restricted' as const, label: 'My Restricted' },
          { key: 'qualifiers' as const, label: 'Qualifiers' },
          { key: 'tags' as const, label: 'Tags' },
          { key: 'restrictions' as const, label: 'Restrictions' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white dark:bg-dark-muted text-gray-900 dark:text-dark-text shadow-sm'
                : 'text-gray-600 dark:text-dark-mutedText hover:text-gray-900 dark:hover:text-dark-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* My Restricted Assets */}
      {activeTab === 'my-restricted' && (
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            My Restricted Assets
          </h2>
          {restrictedLoading ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-dark-mutedText">
              Loading restricted assets...
            </p>
          ) : !restrictedAssets || restrictedAssets.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-dark-mutedText">
              No restricted assets owned yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
                  <tr>
                    <th className="px-4 py-3 font-medium">Asset Name</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Verifier</th>
                    <th className="px-4 py-3 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {restrictedAssets.map((asset: RestrictedAsset, i: number) => (
                    <tr
                      key={String(asset.assetId)}
                      className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-dark-text">
                        {String(asset.assetLabel)}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                        <span className="rounded-full bg-amber-100 dark:bg-amber-500 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-white">
                          {String(asset.restrictionType)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                        {String(asset.verifier).slice(0, 12)}...{String(asset.verifier).slice(-8)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-dark-text">
                        {Number(asset.balance).toFixed(8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Qualifiers */}
      {activeTab === 'qualifiers' && (
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            My Qualifiers
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-dark-mutedText">
            Qualifiers you own and can assign to addresses.
          </p>
          <div className="mt-4">
            <p className="text-sm text-gray-500 dark:text-dark-mutedText">
              Qualifiers can only be issued via CLI for now.
            </p>
          </div>
          {qualifiersLoading ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-dark-mutedText">
              Loading qualifiers...
            </p>
          ) : !qualifiers || qualifiers.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-dark-mutedText">
              No qualifiers found.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {qualifiers.map((q: Qualifier) => (
                <div
                  key={q.qualifier}
                  className="flex items-center justify-between rounded-md border bg-gray-50 dark:bg-dark-elevated px-4 py-3"
                >
                  <span className="font-mono text-sm text-gray-800 dark:text-dark-secondary">
                    {q.qualifier}
                  </span>
                  <span className="font-mono text-xs text-gray-400 dark:text-dark-mutedText">
                    {q.txid?.slice(0, 10)}...{q.txid?.slice(-6)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      {activeTab === 'tags' && (
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            Address Tags
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-dark-mutedText">
            Manage tags on your addresses for restricted asset transfers.
          </p>
          {tagsLoading ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-dark-mutedText">Loading tags...</p>
          ) : !tags || tags.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-dark-mutedText">
              No address tags found.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
                  <tr>
                    <th className="px-4 py-3 font-medium">Address</th>
                    <th className="px-4 py-3 font-medium">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {tags.map((t: AddressTag, i: number) => (
                    <tr
                      key={t.address + i}
                      className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                        {t.address.slice(0, 12)}...{t.address.slice(-8)}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-dark-text">{t.tag}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Restrictions */}
      {activeTab === 'restrictions' && (
        <div className="rounded-lg border bg-white dark:bg-dark-surface p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-dark-secondary">
            Address Restrictions
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-dark-mutedText">
            View addresses that have been frozen for restricted assets.
          </p>
          {restrictionsLoading ? (
            <p className="mt-4 text-sm text-gray-500 dark:text-dark-mutedText">
              Loading restrictions...
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-gray-50 dark:bg-dark-elevated text-gray-500 dark:text-dark-mutedText">
                  <tr>
                    <th className="px-4 py-3 font-medium">Address</th>
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!restrictions || restrictions.length === 0 ? (
                    <tr>
                      <td className="px-4 py-3 text-gray-400 dark:text-dark-mutedText" colSpan={4}>
                        No restrictions found.
                      </td>
                    </tr>
                  ) : (
                    restrictions.map((r: AddressRestriction, i: number) => (
                      <tr
                        key={r.address + i}
                        className={`border-b ${i % 2 === 0 ? 'bg-white dark:bg-dark-surface' : 'bg-gray-50 dark:bg-dark-elevated'}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-dark-mutedText">
                          {r.address.slice(0, 12)}...{r.address.slice(-8)}
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                          {r.assetLabel || r.assetId}
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-dark-text">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.status === 'frozen'
                                ? 'bg-red-100 dark:bg-red-500 text-red-700 dark:text-white'
                                : 'bg-green-100 dark:bg-green-500 text-green-700 dark:text-white'
                            }`}
                          >
                            {r.status || 'active'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-dark-text">
                          <span className="text-xs text-gray-400 dark:text-dark-mutedText">
                            {r.status || 'active'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RestrictedAssets;
