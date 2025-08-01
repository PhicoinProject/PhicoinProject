// Copyright (c) 2009-2010 Satoshi Nakamoto
// Copyright (c) 2009-2016 The Bitcoin Core developers
// Copyright (c) 2017-2020 The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include "pow.h"

#include "arith_uint256.h"
#include "chain.h"
#include "primitives/block.h"
#include "uint256.h"
#include "util.h"
#include "validation.h"
#include "chainparams.h"
#include "tinyformat.h"

unsigned int static DarkGravityWave(const CBlockIndex* pindexLast, const CBlockHeader *pblock, const Consensus::Params& params) {
    /* current difficulty formula, dash - DarkGravity v3, written by Evan Duffield - evan@dash.org */
    assert(pindexLast != nullptr);

    unsigned int nProofOfWorkLimit = UintToArith256(params.powLimit).GetCompact();
    const arith_uint256 bnPowLimit = UintToArith256(params.powLimit);
    int64_t nPastBlocks = 240; // Security optimized: 240 blocks = 60 minutes for 15-second blocks

    // make sure we have at least (nPastBlocks + 1) blocks, otherwise just return powLimit
    if (!pindexLast || pindexLast->nHeight < nPastBlocks) {
        return bnPowLimit.GetCompact();
    }

    if (params.fPowAllowMinDifficultyBlocks && params.fPowNoRetargeting) {
        // Special difficulty rule:
        // If the new block's timestamp is more than 2 * 1 minutes
        // then allow mining of a min-difficulty block.
        if (pblock->GetBlockTime() > pindexLast->GetBlockTime() + params.nPowTargetSpacing * 2)
            return nProofOfWorkLimit;
        else {
            // Return the last non-special-min-difficulty-rules-block
            const CBlockIndex *pindex = pindexLast;
            while (pindex->pprev && pindex->nHeight % params.DifficultyAdjustmentInterval() != 0 &&
                   pindex->nBits == nProofOfWorkLimit)
                pindex = pindex->pprev;
            return pindex->nBits;
        }
    }

    const CBlockIndex *pindex = pindexLast;
    arith_uint256 bnPastTargetAvg;

    int nPHIHASHBlocksFound = 0;
    for (unsigned int nCountBlocks = 1; nCountBlocks <= nPastBlocks; nCountBlocks++) {
        arith_uint256 bnTarget = arith_uint256().SetCompact(pindex->nBits);
        if (nCountBlocks == 1) {
            bnPastTargetAvg = bnTarget;
        } else {
            // NOTE: that's not an average really...
            bnPastTargetAvg = (bnPastTargetAvg * nCountBlocks + bnTarget) / (nCountBlocks + 1);
        }

        // Count how blocks are PHIHASH mined in the last 240 blocks
        if (pindex->nTime >= nPHIHASHActivationTime) {
            nPHIHASHBlocksFound++;
        }

        if(nCountBlocks != nPastBlocks) {
            assert(pindex->pprev); // should never fail
            pindex = pindex->pprev;
        }
    }

    // If we are mining a PHIHASH block. We check to see if we have mined
    // 240 PHIHASH blocks already. If we haven't we are going to return our
    // temp limit. This will allow us to change algos to phihash without having to
    // change the DGW math.
    if (pblock->nTime >= nPHIHASHActivationTime) {
        if (nPHIHASHBlocksFound != nPastBlocks) {
            const arith_uint256 bnPhiHashLimit = UintToArith256(params.phihashLimit);
            return bnPhiHashLimit.GetCompact();
        }
    }

    arith_uint256 bnNew(bnPastTargetAvg);

    int64_t nActualTimespan = pindexLast->GetBlockTime() - pindex->GetBlockTime();
    // NOTE: is this accurate? nActualTimespan counts it for (nPastBlocks - 1) blocks only...
    int64_t nTargetTimespan = nPastBlocks * params.nPowTargetSpacing;

    if (nActualTimespan < nTargetTimespan/3)
        nActualTimespan = nTargetTimespan/3;
    if (nActualTimespan > nTargetTimespan*3)
        nActualTimespan = nTargetTimespan*3;

    // Retarget
    bnNew *= nActualTimespan;
    bnNew /= nTargetTimespan;

    if (bnNew > bnPowLimit) {
        bnNew = bnPowLimit;
    }

    return bnNew.GetCompact();
}

unsigned int GetNextWorkRequiredBTC(const CBlockIndex* pindexLast, const CBlockHeader *pblock, const Consensus::Params& params)
{
    assert(pindexLast != nullptr);
    unsigned int nProofOfWorkLimit = UintToArith256(params.powLimit).GetCompact();

    // Only change once per difficulty adjustment interval
    if ((pindexLast->nHeight+1) % params.DifficultyAdjustmentInterval() != 0)
    {
        if (params.fPowAllowMinDifficultyBlocks)
        {
            // Special difficulty rule for testnet:
            // If the new block's timestamp is more than 2* 10 minutes
            // then allow mining of a min-difficulty block.
            if (pblock->GetBlockTime() > pindexLast->GetBlockTime() + params.nPowTargetSpacing*2)
                return nProofOfWorkLimit;
            else
            {
                // Return the last non-special-min-difficulty-rules-block
                const CBlockIndex* pindex = pindexLast;
                while (pindex->pprev && pindex->nHeight % params.DifficultyAdjustmentInterval() != 0 && pindex->nBits == nProofOfWorkLimit)
                    pindex = pindex->pprev;
                return pindex->nBits;
            }
        }
        return pindexLast->nBits;
    }

    // Go back by what we want to be 14 days worth of blocks
    int nHeightFirst = pindexLast->nHeight - (params.DifficultyAdjustmentInterval()-1);
    assert(nHeightFirst >= 0);
    const CBlockIndex* pindexFirst = pindexLast->GetAncestor(nHeightFirst);
    assert(pindexFirst);

    return CalculateNextWorkRequired(pindexLast, pindexFirst->GetBlockTime(), params);
}

unsigned int GetNextWorkRequired(const CBlockIndex* pindexLast, const CBlockHeader *pblock, const Consensus::Params& params)
{
//    int64_t nPrevBlockTime = (pindexLast->pprev ? pindexLast->pprev->GetBlockTime() : pindexLast->GetBlockTime());  //<- Commented out - fixes "not used" warning

    if (IsDGWActive(pindexLast->nHeight + 1)) {
//        LogPrint(BCLog::NET, "Block %s - version: %s: found next work required using DGW: [%s] (BTC would have been [%s]\t(%+d)\t(%0.3f%%)\t(%s sec))\n",
//                 pindexLast->nHeight + 1, pblock->nVersion, dgw, btc, btc - dgw, (float)(btc - dgw) * 100.0 / (float)dgw, pindexLast->GetBlockTime() - nPrevBlockTime);
        return DarkGravityWave(pindexLast, pblock, params);
    }
    else {
//        LogPrint(BCLog::NET, "Block %s - version: %s: found next work required using BTC: [%s] (DGW would have been [%s]\t(%+d)\t(%0.3f%%)\t(%s sec))\n",
//                  pindexLast->nHeight + 1, pblock->nVersion, btc, dgw, dgw - btc, (float)(dgw - btc) * 100.0 / (float)btc, pindexLast->GetBlockTime() - nPrevBlockTime);
        return GetNextWorkRequiredBTC(pindexLast, pblock, params);
    }

}

unsigned int CalculateNextWorkRequired(const CBlockIndex* pindexLast, int64_t nFirstBlockTime, const Consensus::Params& params)
{
    if (params.fPowNoRetargeting)
        return pindexLast->nBits;

    // Limit adjustment step
    int64_t nActualTimespan = pindexLast->GetBlockTime() - nFirstBlockTime;
    if (nActualTimespan < params.nPowTargetTimespan/4)
        nActualTimespan = params.nPowTargetTimespan/4;
    if (nActualTimespan > params.nPowTargetTimespan*4)
        nActualTimespan = params.nPowTargetTimespan*4;

    // Retarget
    const arith_uint256 bnPowLimit = UintToArith256(params.powLimit);
    arith_uint256 bnNew;
    bnNew.SetCompact(pindexLast->nBits);
    bnNew *= nActualTimespan;
    bnNew /= params.nPowTargetTimespan;

    if (bnNew > bnPowLimit)
        bnNew = bnPowLimit;

    return bnNew.GetCompact();
}

// bool CheckProofOfWork(uint256 hash, unsigned int nBits, const Consensus::Params& params)
// {
//     bool fNegative;
//     bool fOverflow;
//     arith_uint256 bnTarget;

//     bnTarget.SetCompact(nBits, &fNegative, &fOverflow);


//     // Check range
//     if (fNegative || bnTarget == 0 || fOverflow || bnTarget > UintToArith256(params.powLimit)){

//         return false;
//     }


//     // Check proof of work matches claimed amount
//     if (UintToArith256(hash) > bnTarget){

//         return false;
//     }


//     return true;
// }
bool CheckProofOfWork(uint256 hash, unsigned int nBits, const Consensus::Params& params)
{
    bool fNegative;
    bool fOverflow;
    arith_uint256 bnTarget;

    // Log the nBits in compact format
    // LogPrintf("CheckProofOfWork: nBits (compact format): %08x\n", nBits);

    // Set the target difficulty
    bnTarget.SetCompact(nBits, &fNegative, &fOverflow);

    // Log the decoded target difficulty and flag values
    // LogPrintf("CheckProofOfWork: Decoded bnTarget: %s\n", bnTarget.ToString());
    // LogPrintf("CheckProofOfWork: fNegative: %s, fOverflow: %s\n", fNegative ? "true" : "false", fOverflow ? "true" : "false");

    // Log the global difficulty limit
    // LogPrintf("CheckProofOfWork: powLimit: %s\n", UintToArith256(params.powLimit).ToString());

    // Check if the target difficulty is within the valid range
    if (fNegative || bnTarget == 0 || fOverflow || bnTarget > UintToArith256(params.powLimit)) {
        LogPrintf("CheckProofOfWork: Failed range check: ");
        if (fNegative) LogPrintf("fNegative is true. ");
        if (bnTarget == 0) LogPrintf("bnTarget is 0. ");
        if (fOverflow) LogPrintf("fOverflow is true. ");
        if (bnTarget > UintToArith256(params.powLimit)) LogPrintf("bnTarget exceeds powLimit. ");
        LogPrintf("\n");
        return false;
    }

    // Log the block hash and comparison with target difficulty
    // LogPrintf("CheckProofOfWork: Hash: %s\n", UintToArith256(hash).ToString());
    // LogPrintf("CheckProofOfWork: Comparing hash <= bnTarget: %s\n", UintToArith256(hash) <= bnTarget ? "true" : "false");

    // Verify if proof of work meets the required difficulty
    if (UintToArith256(hash) > bnTarget) {
        LogPrintf("CheckProofOfWork: Proof of work failed: hash is greater than bnTarget.\n");
        return false;
    }

    // LogPrintf("CheckProofOfWork: Proof of work passed.\n");
    return true;
}