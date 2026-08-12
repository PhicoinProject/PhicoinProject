// Copyright (c) @2026 The PHICOIN Core developers
// Distributed under the MIT/X11 software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include "chain.h"
#include "chainparams.h"
#include "consensus/validation.h"
#include "miner.h"
#include "policy/policy.h"
#include "pow.h"
#include "script/standard.h"
#include "test/test_phicoin.h"
#include "validation.h"

#include <memory>
#include <boost/test/unit_test.hpp>

//
// Regression coverage for the KAWPOW/PHIHASH declared-height consensus flaw.
//
// A PHIHASH block header carries its own nHeight field. That field is not
// decorative: it feeds the proof-of-work hash and selects the PHIHASH epoch.
// CheckBlockHeader() takes a cheap validation path for any block that claims
// to sit at or below the last compiled checkpoint, verifying only the final
// hash over the supplied mix_hash and never checking that mix_hash is a
// genuine PHIHASH mix.
//
// Because that decision is taken on the height the block declares ABOUT
// ITSELF, a block mined at the current tip can opt into the cheap path from
// any position in the chain simply by lying about its height. Producing such
// a block costs a plain hash search with no memory-hard step.
//
// ContextualCheckBlockHeader() derives the true height from the parent
// (pindexPrev->nHeight + 1) but historically never compared it against the
// declared value. These tests pin that comparison down.
//
BOOST_FIXTURE_TEST_SUITE(validation_block_height_tests, TestingSetup)

    static BlockAssembler AssemblerForTest(const CChainParams& params)
    {
        BlockAssembler::Options options;
        options.nBlockMaxWeight = MAX_BLOCK_WEIGHT;
        options.blockMinFeeRate = CFeeRate(DEFAULT_BLOCK_MIN_TX_FEE);
        return BlockAssembler(params, options);
    }

    // A freshly assembled template must declare exactly its own chain height.
    // This is the invariant an honest miner already satisfies (miner.cpp sets
    // pblock->nHeight = nHeight), and it is what the consensus rule enforces.
    BOOST_AUTO_TEST_CASE(header_height_matches_chain_position)
    {
        BOOST_TEST_MESSAGE("Running Header Height Matches Chain Position Test");

        const auto chainParams = CreateChainParams(CBaseChainParams::REGTEST);
        CScript scriptPubKey = CScript() << OP_TRUE;

        std::unique_ptr<CBlockTemplate> pblocktemplate =
            AssemblerForTest(*chainParams).CreateNewBlock(scriptPubKey);
        BOOST_REQUIRE(pblocktemplate);

        CBlock& block = pblocktemplate->block;
        const int nExpectedHeight = chainActive.Tip()->nHeight + 1;

        BOOST_CHECK_EQUAL((int)block.nHeight, nExpectedHeight);
    }

    // The core regression: a block whose header declares a height other than
    // its real position in the chain must be rejected with "bad-blk-height".
    //
    // Before the fix this assertion fails -- the forged block validates
    // successfully, because nothing anywhere binds the declared height to the
    // chain-derived height.
    BOOST_AUTO_TEST_CASE(reject_header_declaring_wrong_height)
    {
        BOOST_TEST_MESSAGE("Running Reject Header Declaring Wrong Height Test");

        const auto chainParams = CreateChainParams(CBaseChainParams::REGTEST);
        CScript scriptPubKey = CScript() << OP_TRUE;

        std::unique_ptr<CBlockTemplate> pblocktemplate =
            AssemblerForTest(*chainParams).CreateNewBlock(scriptPubKey);
        BOOST_REQUIRE(pblocktemplate);

        CBlock block = pblocktemplate->block;
        CBlockIndex* pindexPrev = chainActive.Tip();
        BOOST_REQUIRE(pindexPrev);

        // Skip proof-of-work and merkle re-derivation so the test isolates the
        // contextual height rule rather than incidentally failing on PoW.
        block.fChecked = true;

        // Sanity: the untampered template is accepted on this seam.
        {
            CValidationState state;
            BOOST_CHECK_MESSAGE(
                TestBlockValidity(state, *chainParams, block, pindexPrev, false, false),
                "baseline template should validate: " << FormatStateMessage(state));
        }

        // Now lie about the height, exactly as the exploit does. Declaring a
        // height at or below the last checkpoint is what buys the attacker the
        // cheap validation path.
        //
        // Pick a value that is guaranteed to differ from the real position:
        // on a fresh regtest chain the next block genuinely IS height 1, so a
        // hardcoded 1 would accidentally be correct and prove nothing.
        const uint32_t nRealHeight = static_cast<uint32_t>(pindexPrev->nHeight + 1);
        block.nHeight = nRealHeight + 1;

        CValidationState state;
        const bool fValid =
            TestBlockValidity(state, *chainParams, block, pindexPrev, false, false);

        BOOST_CHECK_MESSAGE(!fValid,
            "block declaring height " << block.nHeight << " at chain position "
            << nRealHeight << " must be rejected");
        BOOST_CHECK(state.IsInvalid());
        BOOST_CHECK_EQUAL(state.GetRejectReason(), "bad-blk-height");
    }

    // The rule must be symmetric: declaring a height ABOVE the real position
    // is equally invalid. This guards against a fix that only compares one
    // direction (e.g. a "<= checkpoint" style test).
    BOOST_AUTO_TEST_CASE(reject_header_declaring_future_height)
    {
        BOOST_TEST_MESSAGE("Running Reject Header Declaring Future Height Test");

        const auto chainParams = CreateChainParams(CBaseChainParams::REGTEST);
        CScript scriptPubKey = CScript() << OP_TRUE;

        std::unique_ptr<CBlockTemplate> pblocktemplate =
            AssemblerForTest(*chainParams).CreateNewBlock(scriptPubKey);
        BOOST_REQUIRE(pblocktemplate);

        CBlock block = pblocktemplate->block;
        CBlockIndex* pindexPrev = chainActive.Tip();
        BOOST_REQUIRE(pindexPrev);

        block.fChecked = true;
        block.nHeight = pindexPrev->nHeight + 500;

        CValidationState state;
        const bool fValid =
            TestBlockValidity(state, *chainParams, block, pindexPrev, false, false);

        BOOST_CHECK_MESSAGE(!fValid, "block declaring an inflated height must be rejected");
        BOOST_CHECK(state.IsInvalid());
        BOOST_CHECK_EQUAL(state.GetRejectReason(), "bad-blk-height");
    }

    // The exploit's real shape: a block declares a LOW historical height (at
    // or below the last checkpoint) so that CheckBlockHeader() lets it skip
    // genuine PHIHASH work.
    //
    // This exercises ProcessNewBlockHeaders(), the entry point a peer's
    // headers actually travel through, rather than TestBlockValidity() --
    // which asserts pindexPrev == chainActive.Tip() and so cannot express a
    // header arriving for any other position.
    BOOST_AUTO_TEST_CASE(reject_header_declaring_historical_height)
    {
        BOOST_TEST_MESSAGE("Running Reject Header Declaring Historical Height Test");

        const auto chainParams = CreateChainParams(CBaseChainParams::REGTEST);
        CScript scriptPubKey = CScript() << OP_TRUE;

        std::unique_ptr<CBlockTemplate> pblocktemplate =
            AssemblerForTest(*chainParams).CreateNewBlock(scriptPubKey);
        BOOST_REQUIRE(pblocktemplate);

        CBlockIndex* pindexPrev = chainActive.Tip();
        BOOST_REQUIRE(pindexPrev);
        const uint32_t nRealHeight = static_cast<uint32_t>(pindexPrev->nHeight + 1);

        // A header whose declared height is not its chain position. Using 0
        // (the genesis height) makes the lie unambiguous for any tip.
        CBlockHeader forged = pblocktemplate->block.GetBlockHeader();
        forged.nHeight = 0;
        BOOST_REQUIRE(forged.nHeight != nRealHeight);

        CValidationState state;
        const CBlockIndex* pindexResult = nullptr;
        CBlockHeader first_invalid;
        const bool fAccepted = ProcessNewBlockHeaders(
            {forged}, state, *chainParams, &pindexResult, &first_invalid);

        BOOST_CHECK_MESSAGE(!fAccepted,
            "header declaring height " << forged.nHeight << " at chain position "
            << nRealHeight << " must be rejected");
        BOOST_CHECK(state.IsInvalid());

        // Either rejection is correct and both prove the forgery is stopped:
        //   bad-blk-height -- the new consensus rule fired first
        //   high-hash1     -- the header took the cheap below-checkpoint path
        //                     (which is only reachable BECAUSE it lied about
        //                     its height) and failed there
        // Pinning only the former would make the test depend on check order.
        const std::string reason = state.GetRejectReason();
        BOOST_CHECK_MESSAGE(reason == "bad-blk-height" || reason == "high-hash1",
            "unexpected reject reason: " << reason);

        // A forged header must never reach the block index.
        {
            LOCK(cs_main);
            BOOST_CHECK(mapBlockIndex.count(forged.GetHash()) == 0);
        }
    }

BOOST_AUTO_TEST_SUITE_END()
