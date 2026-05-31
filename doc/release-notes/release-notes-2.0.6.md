# PHICOIN Core 2.0.6 Release Notes

PHICOIN Core 2.0.6 is a maintenance release of the node software (`phicoind`
daemon and `phicoin-cli`). It contains RPC performance and feature improvements.
There are no consensus rule changes in this release; upgrading is optional and
backward compatible. No reindex or chain re-download is required.

## How to Upgrade

Shut down the running node, replace `phicoind` / `phicoin-cli` with the new
binaries, and restart. The data directory and `wallet.dat` are unchanged and
fully compatible (Berkeley DB 4.8).

## Notable Changes

### RPC

- **`getblockchaininfo` is now fast on long chains.** The BIP9 soft-fork
  `since` height for terminal (`active` / `failed`) deployments is cached
  instead of being recomputed on every call. Because this chain configures its
  deployments with a one-block confirmation window, the previous code performed
  an O(chain-length) backward walk per deployment on every invocation, which
  made `getblockchaininfo` take several seconds on a multi-million-block chain.
  This is a display/RPC-only optimization: the cached value is never read by
  block validation, `ComputeBlockVersion`, or any deployment-activation check,
  so it has no effect on consensus.

- **`listassetbalancesbyaddress` accepts multiple addresses in one call.** In
  addition to the existing single-address form, the first argument may now be an
  object of the form `{"addresses":["addr1","addr2",...]}` (up to 1000
  addresses) to look up balances for many addresses in a single request. The
  result is keyed by address. The single-address form and its output are
  unchanged.

### Housekeeping

- Client version metadata and repository file-permission/ignore hygiene updates.

## Credits

Thanks to everyone who contributed to this release.
