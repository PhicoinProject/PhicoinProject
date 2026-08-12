// Copyright (c) @2026 The PHICOIN Core developers
// Distributed under the MIT/X11 software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <assets/assets.h>

#include <test/test_phicoin.h>

#include <boost/test/unit_test.hpp>

#include <amount.h>
#include <base58.h>
#include <consensus/tx_verify.h>
#include <consensus/validation.h>
#include <script/standard.h>
#include <validation.h>

//
// Regression coverage for asset amount overflow in Consensus::CheckTxAssets().
//
// The input/output reconciliation is an exact-equality test:
//
//     if (totalInputs.at(name) != totalOutputs.at(name))
//         reject "Assets would be burnt"
//
// That is only safe if the accumulation cannot wrap. Both sides accumulate
// into a CAmount (int64_t) with no overflow guard:
//
//     totalOutputs.at(transfer.strName) += transfer.nAmount;
//
// and nothing on the asset path bounds a single transfer amount:
//
//   * CAssetTransfer::IsValid       -- only rejects nAmount <= 0
//   * ContextualCheckTransferAsset  -- only rejects nAmount <= 0
//   * CheckAmountWithUnits          -- only a divisibility test, no bound
//   * MoneyRange()                  -- never called on the asset path; the
//                                      three call sites in tx_verify.cpp all
//                                      guard native PHI amounts
//
// So a holder of a tiny quantity can emit several outputs whose amounts sum
// past 2^63, wrap to the input total, and mint assets from nothing. This is
// the same class of bug as the Ravencoin "asset transfer qty overflow"
// advisory (upstream RVN PR #1287).
//
BOOST_FIXTURE_TEST_SUITE(asset_overflow_tests, BasicTestingSetup)

    // Build a coin whose scriptPubKey carries an asset transfer of nAmount.
    static CTxOut AssetTxOut(const std::string& name, const CAmount nAmount)
    {
        CAssetTransfer transfer(name, nAmount);
        CScript scriptPubKey =
            GetScriptForDestination(DecodeDestination(GetParams().GlobalBurnAddress()));
        transfer.ConstructTransaction(scriptPubKey);

        CTxOut out;
        out.nValue = 0;
        out.scriptPubKey = scriptPubKey;
        return out;
    }

    // A transaction spending qty 1 while emitting outputs that sum to
    // 2^64 + 1 must be rejected. Signed 64-bit wraparound turns that sum back
    // into 1, which is exactly the input total, so an unguarded equality check
    // sees a balanced transaction and lets the attacker mint 4 x 2^62 units
    // out of a single unit.
    BOOST_AUTO_TEST_CASE(reject_transfer_amount_overflow)
    {
        BOOST_TEST_MESSAGE("Running Reject Transfer Amount Overflow Test");

        SelectParams(CBaseChainParams::MAIN);

        const std::string strName = "PHICOINTEST";

        CCoinsView view;
        CCoinsViewCache coins(&view);

        // Input: the attacker legitimately holds exactly 1 unit.
        CTxOut txIn = AssetTxOut(strName, 1);
        uint256 hash = uint256S("BF50CB9A63BE0019171456252989A459A7D0A5F494735278290079D22AB704A2");
        COutPoint outpoint(hash, 1);
        coins.AddCoin(outpoint, Coin(txIn, 10, 0), true);

        CMutableTransaction mutTx;
        CTxIn in;
        in.prevout = outpoint;
        mutTx.vin.emplace_back(in);

        // Outputs: 4 x 2^62 + 1. Each individual amount is positive, is not
        // bounded by anything on this path, and is divisible by 10^0, so every
        // per-output check passes.
        const CAmount huge = CAmount(1) << 62;   // 4,611,686,018,427,387,904
        mutTx.vout.emplace_back(AssetTxOut(strName, huge));
        mutTx.vout.emplace_back(AssetTxOut(strName, huge));
        mutTx.vout.emplace_back(AssetTxOut(strName, huge));
        mutTx.vout.emplace_back(AssetTxOut(strName, huge));
        mutTx.vout.emplace_back(AssetTxOut(strName, 1));

        CTransaction tx(mutTx);
        CValidationState state;
        std::vector<std::pair<std::string, uint256>> vReissueAssets;

        const bool fValid = Consensus::CheckTxAssets(
            tx, state, coins, nullptr, false, vReissueAssets, true);

        BOOST_CHECK_MESSAGE(!fValid,
            "transaction whose asset outputs overflow int64 must be rejected");
        BOOST_CHECK(state.IsInvalid());
    }

    // Same wraparound reached from the input side: a coin carrying an absurd
    // quantity must not be accepted as a legitimate input total.
    BOOST_AUTO_TEST_CASE(reject_input_amount_overflow)
    {
        BOOST_TEST_MESSAGE("Running Reject Input Amount Overflow Test");

        SelectParams(CBaseChainParams::MAIN);

        const std::string strName = "PHICOINTEST";
        const CAmount huge = CAmount(1) << 62;

        CCoinsView view;
        CCoinsViewCache coins(&view);

        CMutableTransaction mutTx;
        uint256 hash = uint256S("BF50CB9A63BE0019171456252989A459A7D0A5F494735278290079D22AB704A2");

        // Four inputs of 2^62 each: the input side wraps the same way.
        for (uint32_t i = 0; i < 4; ++i) {
            CTxOut txIn = AssetTxOut(strName, huge);
            COutPoint outpoint(hash, i);
            coins.AddCoin(outpoint, Coin(txIn, 10, 0), true);

            CTxIn in;
            in.prevout = outpoint;
            mutTx.vin.emplace_back(in);
        }

        mutTx.vout.emplace_back(AssetTxOut(strName, 1));

        CTransaction tx(mutTx);
        CValidationState state;
        std::vector<std::pair<std::string, uint256>> vReissueAssets;

        const bool fValid = Consensus::CheckTxAssets(
            tx, state, coins, nullptr, false, vReissueAssets, true);

        BOOST_CHECK_MESSAGE(!fValid,
            "transaction whose asset inputs overflow int64 must be rejected");
        BOOST_CHECK(state.IsInvalid());
    }

    // Guard against a fix that merely clamps the running total: a single
    // output amount beyond any sane supply must be rejected on its own.
    BOOST_AUTO_TEST_CASE(reject_single_transfer_above_max_money)
    {
        BOOST_TEST_MESSAGE("Running Reject Single Transfer Above MAX_MONEY Test");

        SelectParams(CBaseChainParams::MAIN);

        const std::string strName = "PHICOINTEST";

        CCoinsView view;
        CCoinsViewCache coins(&view);

        CTxOut txIn = AssetTxOut(strName, MAX_MONEY + 1);
        uint256 hash = uint256S("BF50CB9A63BE0019171456252989A459A7D0A5F494735278290079D22AB704A2");
        COutPoint outpoint(hash, 1);
        coins.AddCoin(outpoint, Coin(txIn, 10, 0), true);

        CMutableTransaction mutTx;
        CTxIn in;
        in.prevout = outpoint;
        mutTx.vin.emplace_back(in);
        mutTx.vout.emplace_back(AssetTxOut(strName, MAX_MONEY + 1));

        CTransaction tx(mutTx);
        CValidationState state;
        std::vector<std::pair<std::string, uint256>> vReissueAssets;

        const bool fValid = Consensus::CheckTxAssets(
            tx, state, coins, nullptr, false, vReissueAssets, true);

        BOOST_CHECK_MESSAGE(!fValid,
            "asset transfer above MAX_MONEY must be rejected");
        BOOST_CHECK(state.IsInvalid());
    }

    // Sanity: an ordinary balanced transfer must still be accepted, so the
    // overflow guard cannot be satisfied by rejecting everything.
    BOOST_AUTO_TEST_CASE(accept_ordinary_balanced_transfer)
    {
        BOOST_TEST_MESSAGE("Running Accept Ordinary Balanced Transfer Test");

        SelectParams(CBaseChainParams::MAIN);

        const std::string strName = "PHICOINTEST";

        CCoinsView view;
        CCoinsViewCache coins(&view);

        CTxOut txOut = AssetTxOut(strName, 1000);
        uint256 hash = uint256S("BF50CB9A63BE0019171456252989A459A7D0A5F494735278290079D22AB704A2");
        COutPoint outpoint(hash, 1);
        coins.AddCoin(outpoint, Coin(txOut, 10, 0), true);

        CMutableTransaction mutTx;
        CTxIn in;
        in.prevout = outpoint;
        mutTx.vin.emplace_back(in);
        mutTx.vout.emplace_back(txOut);

        CTransaction tx(mutTx);
        CValidationState state;
        std::vector<std::pair<std::string, uint256>> vReissueAssets;

        BOOST_CHECK_MESSAGE(
            Consensus::CheckTxAssets(tx, state, coins, nullptr, false, vReissueAssets, true),
            "balanced 1000-unit transfer should remain valid");
    }

    // The guard itself must not rely on signed overflow. Two inputs of
    // MAX_MONEY each are individually in range, but their sum (1e19) exceeds
    // INT64_MAX (9.22e18). A guard written as MoneyRange(running + amount)
    // computes that sum first, which is undefined behaviour and can be
    // optimised away -- letting nodes built with different compilers disagree
    // on the same transaction. The overflow-free subtraction form must reject
    // this deterministically.
    BOOST_AUTO_TEST_CASE(reject_running_total_overflow_without_ub)
    {
        BOOST_TEST_MESSAGE("Running Reject Running Total Overflow Without UB Test");

        SelectParams(CBaseChainParams::MAIN);

        const std::string strName = "PHICOINTEST";

        CCoinsView view;
        CCoinsViewCache coins(&view);

        CMutableTransaction mutTx;
        uint256 hash = uint256S("BF50CB9A63BE0019171456252989A459A7D0A5F494735278290079D22AB704A2");

        // Two inputs, each exactly MAX_MONEY: individually valid, sum overflows.
        for (uint32_t i = 0; i < 2; ++i) {
            CTxOut txIn = AssetTxOut(strName, MAX_MONEY);
            COutPoint outpoint(hash, i);
            coins.AddCoin(outpoint, Coin(txIn, 10, 0), true);

            CTxIn in;
            in.prevout = outpoint;
            mutTx.vin.emplace_back(in);
        }

        mutTx.vout.emplace_back(AssetTxOut(strName, MAX_MONEY));

        CTransaction tx(mutTx);
        CValidationState state;
        std::vector<std::pair<std::string, uint256>> vReissueAssets;

        const bool fValid = Consensus::CheckTxAssets(
            tx, state, coins, nullptr, false, vReissueAssets, true);

        BOOST_CHECK_MESSAGE(!fValid,
            "running total that would overflow int64 must be rejected");
        BOOST_CHECK(state.IsInvalid());
    }

BOOST_AUTO_TEST_SUITE_END()
