// Copyright (c) 2010 Satoshi Nakamoto
// Copyright (c) 2009-2016 The Bitcoin Core developers
// Copyright (c) 2017-2021  The Ravncore developers
// Copyright (c) @2024 		The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include "chainparams.h"
#include "consensus/merkle.h"

#include "arith_uint256.h"
#include "tinyformat.h"
#include "util.h"
#include "utilstrencodings.h"
#include <limits>
#include "chainparamsseeds.h"
#include <assert.h>

// TODO: Take these out
extern double algoHashTotal[16];
extern int algoHashHits[16];


static CBlock CreateGenesisBlock(const char* pszTimestamp, const CScript& genesisOutputScript, uint32_t nTime, uint32_t nNonce, uint32_t nBits, int32_t nVersion, const CAmount& genesisReward)
{
    CMutableTransaction txNew;
    txNew.nVersion = 1;
    txNew.vin.resize(1);
    txNew.vout.resize(1);
    txNew.vin[0].scriptSig = CScript() << CScriptNum(0) << 486604799 << CScriptNum(4) << std::vector<unsigned char>((const unsigned char*)pszTimestamp, (const unsigned char*)pszTimestamp + strlen(pszTimestamp));
    txNew.vout[0].nValue = genesisReward;
    txNew.vout[0].scriptPubKey = genesisOutputScript;

    CBlock genesis;
    genesis.nTime = nTime;
    genesis.nBits = nBits;
    genesis.nNonce = nNonce;
    genesis.nVersion = nVersion;
    genesis.vtx.push_back(MakeTransactionRef(std::move(txNew)));
    genesis.hashPrevBlock.SetNull();
    genesis.hashMerkleRoot = BlockMerkleRoot(genesis);
    return genesis;
}

/**
 * Build the genesis block. Note that the output of its generation
 * transaction cannot be spent since it did not originally exist in the
 * database.
 *
 * CBlock(hash=000000000019d6, ver=1, hashPrevBlock=00000000000000, hashMerkleRoot=4a5e1e, nTime=1231006505, nBits=1d00ffff, nNonce=2083236893, vtx=1)
 *   CTransaction(hash=4a5e1e, ver=1, vin.size=1, vout.size=1, nLockTime=0)
 *     CTxIn(COutPoint(000000, -1), coinbase 04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73)
 *     CTxOut(nValue=50.00000000, scriptPubKey=0x5F1DF16B2B704C8A578D0B)
 *   vMerkleTree: 4a5e1e
 */
static CBlock CreateGenesisBlock(uint32_t nTime, uint32_t nNonce, uint32_t nBits, int32_t nVersion, const CAmount& genesisReward)
{
    const char* pszTimestamp = "Break the Great Firewall!";
    const CScript genesisOutputScript = CScript() << ParseHex("048e12253ce404c20ff8b0bcff71915d014171e865d2a91a24dde84788762d4815e10e8958f2fdb8f78b464b129b4ea8d071219397db7c24fec7432e5384796485") << OP_CHECKSIG;
    return CreateGenesisBlock(pszTimestamp, genesisOutputScript, nTime, nNonce, nBits, nVersion, genesisReward);
}

void CChainParams::UpdateVersionBitsParameters(Consensus::DeploymentPos d, int64_t nStartTime, int64_t nTimeout)
{
    consensus.vDeployments[d].nStartTime = nStartTime;
    consensus.vDeployments[d].nTimeout = nTimeout;
}

void CChainParams::TurnOffSegwit()
{
    consensus.nSegwitEnabled = false;
}

void CChainParams::TurnOffCSV()
{
    consensus.nCSVEnabled = false;
}

void CChainParams::TurnOffBIP34()
{
    consensus.nBIP34Enabled = false;
}

void CChainParams::TurnOffBIP65()
{
    consensus.nBIP65Enabled = false;
}

void CChainParams::TurnOffBIP66()
{
    consensus.nBIP66Enabled = false;
}

bool CChainParams::BIP34()
{
    return consensus.nBIP34Enabled;
}

bool CChainParams::BIP65()
{
    return consensus.nBIP34Enabled;
}

bool CChainParams::BIP66()
{
    return consensus.nBIP34Enabled;
}

bool CChainParams::CSVEnabled() const
{
    return consensus.nCSVEnabled;
}


/**
 * Main network
 */
/**
 * What makes a good checkpoint block?
 * + Is surrounded by blocks with reasonable timestamps
 *   (no blocks before with a timestamp after, none after with
 *    timestamp before)
 * + Contains no strange transactions
 */

class CMainParams : public CChainParams
{
public:
    CMainParams()
    {
        uint32_t nGenesisTime = 1749020400;
        uint32_t nAssetTime = 1751090400;
        strNetworkID = "main";
        consensus.nSubsidyHalvingInterval = 2102400; //  1 y
        consensus.nBIP34Enabled = true;
        consensus.nBIP65Enabled = true; // 
        consensus.nBIP66Enabled = true;
        consensus.nSegwitEnabled = true;
        consensus.nCSVEnabled = true;
        consensus.powLimit = uint256S("00000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        consensus.phihashLimit = uint256S("0000000000ffffffffffffffffffffffffffffffffffffffffffffffffffffff"); // Estimated starting diff for first 24 phihash blocks
        consensus.nPowTargetTimespan = 3600;     // 60 minutes (240 blocks × 15 seconds) - security optimized                         
        consensus.nPowTargetSpacing = 15;
        consensus.fPowAllowMinDifficultyBlocks = false;
        consensus.fPowNoRetargeting = false;
        consensus.nRuleChangeActivationThreshold = 160; // 2/3 of nMinerConfirmationWindow
        consensus.nMinerConfirmationWindow = 240;       // nPowTargetTimespan / nPowTargetSpacing (security optimized window)
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].bit = 28;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nStartTime = 1199145601; 
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nTimeout = 1199145601;   
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nOverrideRuleChangeActivationThreshold = 1;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nOverrideMinerConfirmationWindow = 1;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].bit = 6;                 // Assets - activate immediately from genesis
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nStartTime = 0; 
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nTimeout = nAssetTime;  
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nOverrideRuleChangeActivationThreshold = 1;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nOverrideMinerConfirmationWindow = 1;
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].bit = 7;                                       // Assets - activate immediately from genesis
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nStartTime = 0;                      
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nTimeout = nAssetTime;                       
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nOverrideRuleChangeActivationThreshold = 1; 
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nOverrideMinerConfirmationWindow = 1;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].bit = 8;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nStartTime = 0;                       
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nTimeout = nAssetTime;                        
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nOverrideRuleChangeActivationThreshold = 1; 
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nOverrideMinerConfirmationWindow = 1;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].bit = 9;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nStartTime = 0;                      
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nTimeout = nAssetTime;                        
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nOverrideRuleChangeActivationThreshold = 1; 
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nOverrideMinerConfirmationWindow = 1;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].bit = 10;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nStartTime = 0;                       
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nTimeout = nAssetTime;                        
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nOverrideRuleChangeActivationThreshold = 1; // Activate immediately from genesis
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nOverrideMinerConfirmationWindow = 1;


        // The best chain should have at least this much work

        consensus.nMinimumChainWork = uint256S("0000000000000000000000000000000000000000000000000000000000000000"); // #150000

        // By default assume that the signatures in ancestors of this block are valid.
        consensus.defaultAssumeValid = uint256S("000000b591270f4349af861f90ec322d330fedc6c207d3357a7d33e941b94659"); // 

        /**
         * The message start string is designed to be unlikely to occur in normal data.
         * The characters are rarely used upper ASCII, not valid as UTF-8, and produce
         * a large 32-bit integer with any alignment.
         */
        pchMessageStart[0] = 0x50; // 'P'
        pchMessageStart[1] = 0x48; // 'H'
        pchMessageStart[2] = 0x49; // 'I'
        pchMessageStart[3] = 0x58; // 'X'

        nDefaultPort = 28964 ;//PHI  22

        nPruneAfterHeight = 2102400;

        uint32_t _nBits=0x1e00ffff;



        genesis = CreateGenesisBlock(nGenesisTime, 15811287, _nBits, 4, 5000 * COIN);
        consensus.hashGenesisBlock = genesis.GetX16RHash();

        //FindMainNetGenesisBlock(nGenesisTime,_nBits,"mainnet");

        assert(consensus.hashGenesisBlock == uint256S("000000b591270f4349af861f90ec322d330fedc6c207d3357a7d33e941b94659"));
        assert(genesis.hashMerkleRoot == uint256S("a295329fa338c93261c12b0a8b495f8a84059a78d35ad670a69092a9a8cbf33f"));

        base58Prefixes[PUBKEY_ADDRESS] = std::vector<unsigned char>(1, 56); // P
        base58Prefixes[SCRIPT_ADDRESS] = std::vector<unsigned char>(1, 16); // H
        base58Prefixes[SECRET_KEY] = std::vector<unsigned char>(1, 128);// Bitcoin standard
        base58Prefixes[EXT_PUBLIC_KEY] = {0x04, 0x88, 0xB2, 0x1E};// Bitcoin standard
        base58Prefixes[EXT_SECRET_KEY] = {0x04, 0x88, 0xAD, 0xE4};// Bitcoin standard

        // PHICOIN BIP44 cointype in mainnet is '0'
        nExtCoinType = 0;

        vFixedSeeds = std::vector<SeedSpec6>(pnSeed6_main, pnSeed6_main + ARRAYLEN(pnSeed6_main));

        vSeeds.emplace_back("seed1.phicoin.net", false); 
        vSeeds.emplace_back("seed2.phicoin.net", false); 
        vSeeds.emplace_back("seed3.phicoin.net", false); 
        vSeeds.emplace_back("seed4.phicoin.net", false); 
        vSeeds.emplace_back("seed5.phicoin.net", false); 
        vSeeds.emplace_back("seed6.phicoin.net", false); 

        fDefaultConsistencyChecks = false;
        fRequireStandard = true;
        fMineBlocksOnDemand = false;
        fMiningRequiresPeers = true;

        checkpointData = (CCheckpointData){
            {
                {0, uint256S("000000b591270f4349af861f90ec322d330fedc6c207d3357a7d33e941b94659")},
                {10000, uint256S("00000003dd587f01dd637803922158343c40f8b795ff5ab3aa2c9e445943e8bf")},
                {15000, uint256S("0000000bdde6ea5e7c0eb088f38423de7cae550b85c7b41c7beddef6a6768bf2")},
                {20000, uint256S("00000006f9e93bf1c642a2bf0102ef0d442b1469acfb4251cf871414be4f19dd")},
            }};

        chainTxData = ChainTxData{
            1751425007, // Update to the latest UNIX timestamp
            37383,     // Update to the latest total number of transactions
            0.1110777642409295 // Update to the latest estimated transactions per second
        };


        /** PHI Start **/
        // Burn Amounts
        nIssueAssetBurnAmount = 0.1 * COIN;
        nReissueAssetBurnAmount = 0.1 * COIN;
        nIssueSubAssetBurnAmount = 0.1 * COIN;
        nIssueUniqueAssetBurnAmount = 0.1 * COIN;
        nIssueMsgChannelAssetBurnAmount = 0.1 * COIN;
        nIssueQualifierAssetBurnAmount = 0.1 * COIN;
        nIssueSubQualifierAssetBurnAmount = 0.1 * COIN;
        nIssueRestrictedAssetBurnAmount = 0.1 * COIN;
        nAddNullQualifierTagBurnAmount = 0.1 * COIN;

        // Global Burn Address
        strGlobalBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";

        // Burn Addresses
        strIssueAssetBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";
        strReissueAssetBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";
        strIssueSubAssetBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";
        strIssueUniqueAssetBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";
        strIssueMsgChannelAssetBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";
        strIssueQualifierAssetBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";
        strIssueSubQualifierAssetBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";
        strIssueRestrictedAssetBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";
        strAddNullQualifierTagBurnAddress = "PkC3bSAjN99cFg9yQbPYn5sQ89Gnvnnmcf";


        strDevAddress = "PfGy9w5jysV8aVw9eRjDqsydHJdnuxSV89";
        
        // DGW Activation
        nDGWActivationBlock = 1;

        nMaxReorganizationDepth = 180; // 45 minutes at 15-second block timespan (security optimized)
        nMinReorganizationPeers = 4;//4
        nMinReorganizationAge = 60 * 60 * 12; // 12 hours

        nAssetActivationHeight = 0;     // Asset activated block height (activated from genesis)
        nMessagingActivationBlock = 0;  // Messaging activated block height (activated from genesis)
        nRestrictedActivationBlock = 0; // Restricted activated block height (activated from genesis)

        nPHIIIIIHASHActTime = nGenesisTime + 1; 
        nPHIHASHActivationTime = nPHIIIIIHASHActTime;
        /** PHI End **/
    }
};

/**
 * Testnet (v7)
 */
class CTestNetParams : public CChainParams
{
public:
    CTestNetParams()
    {
        strNetworkID = "test";
        uint32_t nGenesisTime =1749020400;
        consensus.nSubsidyHalvingInterval = 1000; //
        consensus.nBIP34Enabled = true;
        consensus.nBIP65Enabled = true; // 
        consensus.nBIP66Enabled = true;
        consensus.nSegwitEnabled = true;
        consensus.nCSVEnabled = true;

        consensus.powLimit = uint256S("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        consensus.phihashLimit = uint256S("000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        consensus.nPowTargetTimespan = 900; // 15 minutes (60 blocks × 15 seconds) - faster than mainnet for testing
        consensus.nPowTargetSpacing = 15;
        consensus.fPowAllowMinDifficultyBlocks = false;
        consensus.fPowNoRetargeting = false;
        consensus.nRuleChangeActivationThreshold = 40; // 2/3 of nMinerConfirmationWindow  
        consensus.nMinerConfirmationWindow = 60; // nPowTargetTimespan / nPowTargetSpacing (faster testing)
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].bit = 28;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nStartTime = 1731377205; 
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nTimeout = 1731377205+1800;  
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nOverrideRuleChangeActivationThreshold = 40;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nOverrideMinerConfirmationWindow = 50;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].bit = 5;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nStartTime = 1731377205; 
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nTimeout = 1731377205+1800;  
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nOverrideRuleChangeActivationThreshold = 40;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nOverrideMinerConfirmationWindow = 50;
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].bit = 6;                 // Assets 
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nStartTime = 1731377205; 
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nTimeout = 1731377205+1800;  
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nOverrideRuleChangeActivationThreshold = 40;
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nOverrideMinerConfirmationWindow = 50;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].bit = 8;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nStartTime = 1731377205; 
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nTimeout = 1731377205+1800;   
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nOverrideRuleChangeActivationThreshold = 40;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nOverrideMinerConfirmationWindow = 50;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].bit = 9;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nStartTime = 1731377205;                      
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nTimeout = 1731377205+1800;                        
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nOverrideRuleChangeActivationThreshold = 40;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nOverrideMinerConfirmationWindow = 50;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].bit = 10;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nStartTime = 1731377205;                       
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nTimeout = 1731377205+1800;                        
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nOverrideRuleChangeActivationThreshold = 40; 
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nOverrideMinerConfirmationWindow = 50;

        // The best chain should have at least this much work.
        consensus.nMinimumChainWork = uint256S("0000000000000000000000000000000000000000000000000000000000000000");//6216
        // 0000000261793a9216e324f3fcd3ad272f9f2525d0f160946c79333dbf94993b
        // By default assume that the signatures in ancestors of this block are valid.
        consensus.defaultAssumeValid = uint256S("000000b591270f4349af861f90ec322d330fedc6c207d3357a7d33e941b94659");
        pchMessageStart[0] = 0x84; // T
        pchMessageStart[0] = 0x50; // 'P'
        pchMessageStart[1] = 0x48; // 'H'
        pchMessageStart[2] = 0x49; // 'I'

        nDefaultPort = 28965;
        nPruneAfterHeight = 1000;

        // uint32_t nGenesisTime = 1706774400; // 

        uint32_t _nBits=0x1e00ffff;

        genesis = CreateGenesisBlock(nGenesisTime, 15811287, _nBits, 4, 5000 * COIN);
        consensus.hashGenesisBlock = genesis.GetX16RHash();


        // Test MerkleRoot and GenesisBlock
        assert(consensus.hashGenesisBlock == uint256S("000000b591270f4349af861f90ec322d330fedc6c207d3357a7d33e941b94659"));
        assert(genesis.hashMerkleRoot == uint256S("a295329fa338c93261c12b0a8b495f8a84059a78d35ad670a69092a9a8cbf33f"));

        vSeeds.emplace_back("seed1.test.phicoin.net", false); 

        vSeeds.emplace_back("seed2.test.phicoin.net", false); 

        base58Prefixes[PUBKEY_ADDRESS] = std::vector<unsigned char>(1, 66); // T
        base58Prefixes[SCRIPT_ADDRESS] = std::vector<unsigned char>(1, 66); // T
        base58Prefixes[SECRET_KEY] = std::vector<unsigned char>(1, 239);
        base58Prefixes[EXT_PUBLIC_KEY] = {0x04, 0x35, 0x87, 0xCF};
        base58Prefixes[EXT_SECRET_KEY] = {0x04, 0x35, 0x83, 0x94};

        // Raven BIP44 cointype in testnet
        nExtCoinType = 1;

        vFixedSeeds = std::vector<SeedSpec6>(pnSeed6_test, pnSeed6_test + ARRAYLEN(pnSeed6_test));

        fDefaultConsistencyChecks = false;
        fRequireStandard = false;
        fMineBlocksOnDemand = false;
        fMiningRequiresPeers = true;

        checkpointData = (CCheckpointData){
            {
                //  {0, uint256S("000000e813673e9e9f560bd2b94b5c1a4f481234bd03cff70fb059417a8e327c")},

                }};

        chainTxData = ChainTxData{

            0, // * UNIX timestamp of last known number of transactions
            0,     // * total number of transactions between genesis and that timestamp
                        //   (the tx=... number in the SetBestChain debug.log lines)
            0      // * estimated number of transactions per second after that timestamp
        };


        // Burn Amounts

        nIssueAssetBurnAmount = 0.1 * COIN;
        nReissueAssetBurnAmount = 0.1 * COIN;
        nIssueSubAssetBurnAmount = 0.1 * COIN;
        nIssueUniqueAssetBurnAmount = 0.1 * COIN;
        nIssueMsgChannelAssetBurnAmount = 0.1 * COIN;
        nIssueQualifierAssetBurnAmount = 0.1 * COIN;
        nIssueSubQualifierAssetBurnAmount = 0.1 * COIN;
        nIssueRestrictedAssetBurnAmount = 0.1 * COIN;
        nAddNullQualifierTagBurnAmount = 0.1 * COIN;

        // Burn Addresses
        strIssueAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strReissueAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueSubAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueUniqueAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueMsgChannelAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueQualifierAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueSubQualifierAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueRestrictedAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strAddNullQualifierTagBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";

        strDevAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        
        // Global Burn Address
        strGlobalBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";

        // DGW Activation
        nDGWActivationBlock = 1;

        nMaxReorganizationDepth = 60; // 15 minutes at 15-second block timespan (testnet optimized)
        nMinReorganizationPeers = 2;
        nMinReorganizationAge = 60 * 60 * 12/4; // 12 hours

        nAssetActivationHeight = 0;      // Asset activated block height
        nMessagingActivationBlock = 0;  // Messaging activated block height
        nRestrictedActivationBlock = 0; // Restricted activated block height

        nPHIIIIIHASHActTime = nGenesisTime + 1; 
        nPHIHASHActivationTime = nPHIIIIIHASHActTime;
        /** PHI End **/
    }
};

/**
 * Regression test
 */
class CRegTestParams : public CChainParams
{
public:
    CRegTestParams()
    {
        strNetworkID = "regtest";
        consensus.nBIP34Enabled = true;
        consensus.nBIP65Enabled = true; // 000000000000000004c2b624ed5d7756c508d90fd0da2c7c679febfa6c4735f0
        consensus.nBIP66Enabled = true;
        consensus.nSegwitEnabled = true;
        consensus.nCSVEnabled = true;
        consensus.nSubsidyHalvingInterval = 150;
        consensus.powLimit = uint256S("7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        consensus.phihashLimit = uint256S("7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        consensus.nPowTargetTimespan = 600; // 10 minutes (40 blocks × 15 seconds) - fast adjustment for regtest
        consensus.nPowTargetSpacing = 15;
        consensus.fPowAllowMinDifficultyBlocks = true;
        consensus.fPowNoRetargeting = true;
        consensus.nRuleChangeActivationThreshold = 30; // 75% of nMinerConfirmationWindow  
        consensus.nMinerConfirmationWindow = 40;       // nPowTargetTimespan / nPowTargetSpacing (fast for regtest)
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].bit = 28;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nStartTime = 0;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nTimeout = 999999999999ULL;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nOverrideRuleChangeActivationThreshold = 18;
        consensus.vDeployments[Consensus::DEPLOYMENT_TESTDUMMY].nOverrideMinerConfirmationWindow = 24;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].bit = 6;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nStartTime = 0;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nTimeout = 999999999999ULL;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nOverrideRuleChangeActivationThreshold = 18;
        consensus.vDeployments[Consensus::DEPLOYMENT_ASSETS].nOverrideMinerConfirmationWindow = 24;
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].bit = 7;                    // Assets (RIP5)
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nStartTime = 0;             
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nTimeout = 999999999999ULL;
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nOverrideRuleChangeActivationThreshold = 18;
        consensus.vDeployments[Consensus::DEPLOYMENT_MSG_REST_ASSETS].nOverrideMinerConfirmationWindow = 24;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].bit = 8;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nStartTime = 0;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nTimeout = 999999999999ULL;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nOverrideRuleChangeActivationThreshold = 208;
        consensus.vDeployments[Consensus::DEPLOYMENT_TRANSFER_SCRIPT_SIZE].nOverrideMinerConfirmationWindow = 288;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].bit = 9;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nStartTime = 0;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nTimeout = 999999999999ULL;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nOverrideRuleChangeActivationThreshold = 18;
        consensus.vDeployments[Consensus::DEPLOYMENT_ENFORCE_VALUE].nOverrideMinerConfirmationWindow = 24;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].bit = 10;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nStartTime = 0;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nTimeout = 999999999999ULL;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nOverrideRuleChangeActivationThreshold = 400;
        consensus.vDeployments[Consensus::DEPLOYMENT_COINBASE_ASSETS].nOverrideMinerConfirmationWindow = 500;

        // The best chain should have at least this much work.
        consensus.nMinimumChainWork = uint256S("0x00");

        // By default assume that the signatures in ancestors of this block are valid.
        consensus.defaultAssumeValid = uint256S("0x00");

        pchMessageStart[0] = 0x84; // T
        pchMessageStart[0] = 0x50; // 'P'
        pchMessageStart[1] = 0x48; // 'H'
        pchMessageStart[2] = 0x49; // 'I'

        nDefaultPort = 28966;
        nPruneAfterHeight = 1000;

        uint32_t nGenesisTime = 1749020400; // 

        uint32_t _nBits=0x1e00ffff;
        genesis = CreateGenesisBlock(nGenesisTime, 15811287, _nBits, 4, 5000 * COIN);
        consensus.hashGenesisBlock = genesis.GetX16RHash();

        assert(consensus.hashGenesisBlock == uint256S("000000b591270f4349af861f90ec322d330fedc6c207d3357a7d33e941b94659"));
        assert(genesis.hashMerkleRoot == uint256S("a295329fa338c93261c12b0a8b495f8a84059a78d35ad670a69092a9a8cbf33f"));


        vFixedSeeds.clear(); //!< Regtest mode doesn't have any fixed seeds.
        vSeeds.clear();      //!< Regtest mode doesn't have any DNS seeds.

        fDefaultConsistencyChecks = true;
        fRequireStandard = false;
        fMineBlocksOnDemand = true;

        checkpointData = (CCheckpointData){
            {}};

        chainTxData = ChainTxData{
            0,
            0,
            0};

        base58Prefixes[PUBKEY_ADDRESS] = std::vector<unsigned char>(1, 66); // T
        base58Prefixes[SCRIPT_ADDRESS] = std::vector<unsigned char>(1, 66); // T
        base58Prefixes[SECRET_KEY] = std::vector<unsigned char>(1, 239);
        base58Prefixes[EXT_PUBLIC_KEY] = {0x04, 0x35, 0x87, 0xCF};
        base58Prefixes[EXT_SECRET_KEY] = {0x04, 0x35, 0x83, 0x94};

        // Raven BIP44 cointype in regtest
        nExtCoinType = 1;

        /** PHI Start **/
        // Burn Amounts
        nIssueAssetBurnAmount = 0.1 * COIN;
        nReissueAssetBurnAmount = 0.1 * COIN;
        nIssueSubAssetBurnAmount = 0.1 * COIN;
        nIssueUniqueAssetBurnAmount = 0.1 * COIN;
        nIssueMsgChannelAssetBurnAmount = 0.1 * COIN;
        nIssueQualifierAssetBurnAmount = 0.1 * COIN;
        nIssueSubQualifierAssetBurnAmount = 0.1 * COIN;
        nIssueRestrictedAssetBurnAmount = 0.1 * COIN;
        nAddNullQualifierTagBurnAmount = 0.1 * COIN;

        // Burn Addresses
        strIssueAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strReissueAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueSubAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueUniqueAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueMsgChannelAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueQualifierAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueSubQualifierAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strIssueRestrictedAssetBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strAddNullQualifierTagBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        strDevAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";
        
        // Global Burn Address
        strGlobalBurnAddress = "Tmkx2JgVtBbPKArQwNH9LvkbhvwfakrEHs";

        // DGW Activation
        nDGWActivationBlock = 200;

        nMaxReorganizationDepth = 40; // 10 minutes at 15-second block timespan (regtest optimized)
        nMinReorganizationPeers = 4;
        nMinReorganizationAge = 60 * 60 * 12; // 12 hours

        nAssetActivationHeight = 0;     // Asset activated block height
        nMessagingActivationBlock = 0;  // Messaging activated block height
        nRestrictedActivationBlock = 0; // Restricted activated block height

        // TODO, we need to figure out what to do with this for regtest. This effects the unit tests
        // For now we can use a timestamp very far away
        // If you are looking to test the phihash hashing function in regtest. You will need to change this number
        nPHIIIIIHASHActTime = nGenesisTime + 1; 
        nPHIHASHActivationTime = nPHIIIIIHASHActTime;
        /** PHI End **/
    }
};

static std::unique_ptr<CChainParams> globalChainParams;

const CChainParams& GetParams()
{
    assert(globalChainParams);
    return *globalChainParams;
}

std::unique_ptr<CChainParams> CreateChainParams(const std::string& chain)
{
    if (chain == CBaseChainParams::MAIN)
        return std::unique_ptr<CChainParams>(new CMainParams());
    else if (chain == CBaseChainParams::TESTNET)
        return std::unique_ptr<CChainParams>(new CTestNetParams());
    else if (chain == CBaseChainParams::REGTEST)
        return std::unique_ptr<CChainParams>(new CRegTestParams());
    throw std::runtime_error(strprintf("%s: Unknown chain %s.", __func__, chain));
}

void SelectParams(const std::string& network, bool fForceBlockNetwork)
{
    SelectBaseParams(network);
    if (fForceBlockNetwork) {
        bNetwork.SetNetwork(network);
    }
    globalChainParams = CreateChainParams(network);
}

void UpdateVersionBitsParameters(Consensus::DeploymentPos d, int64_t nStartTime, int64_t nTimeout)
{
    globalChainParams->UpdateVersionBitsParameters(d, nStartTime, nTimeout);
}

void TurnOffSegwit()
{
    globalChainParams->TurnOffSegwit();
}

void TurnOffCSV()
{
    globalChainParams->TurnOffCSV();
}

void TurnOffBIP34()
{
    globalChainParams->TurnOffBIP34();
}

void TurnOffBIP65()
{
    globalChainParams->TurnOffBIP65();
}

void TurnOffBIP66()
{
    globalChainParams->TurnOffBIP66();
}
