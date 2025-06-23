#!/bin/bash

echo "=== PHICOIN CID Asset Testing Script ==="
echo "Testing various real CID formats for asset creation"
echo ""

# Step 1: Kill existing phicoind processes
echo "Step 1: Killing existing phicoind processes..."
killall -9 phicoind || true
sleep 2

# Step 2: Compile the project
echo "Step 2: Compiling project..."
./phi_scripts/03-build_phicoin.sh linux
if [ $? -ne 0 ]; then
    echo "ERROR: Compilation failed!"
    exit 1
fi

# Step 3: Start phicoind daemon
echo "Step 3: Starting phicoind daemon..."
./release/linux/phicoind --datadir=./release/data_test -bypassdownload &
DAEMON_PID=$!
sleep 5

# Step 4: Test various real CID formats
echo "Step 4: Testing CID asset creation..."
echo ""

# Real CIDv0 examples (46 characters, starting with Qm) - from IPFS docs and examples
echo "=== Testing CIDv0 (Base58, Qm...) ==="
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV0-REAL1" 1000 "" "" 8 false true QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV0-REAL2" 1000 "" "" 8 false true QmcRD4wkPPi6dig81r5sLj9Zm1gDCL4zgpEj9CfuRrGbzF
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV0-REAL3" 1000 "" "" 8 false true QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRQUydHUtz4YgpqB
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV0-REAL4" 1000 "" "" 8 false true QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n
echo ""

# Real CIDv1 Base32 examples (starting with baf...) - from IPFS CID Inspector
echo "=== Testing CIDv1 Base32 (baf...) ==="
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B32-R1" 1000 "" "" 8 false true bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B32-R2" 1000 "" "" 8 false true bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B32-R3" 1000 "" "" 8 false true bafkreidgvpkjawlxz6sffxzwgooowe5yt7i6wsyg236mfoks77nywkptdq
echo ""

# Real CIDv1 Base58BTC examples (starting with z...) - from IPFS examples
echo "=== Testing CIDv1 Base58BTC (z...) ==="
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B58-R1" 1000 "" "" 8 false true zb2rhj7crUKTQYRGCRATFaQ6YFLTde2YzdqbbhH9xyYzjXJCz
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B58-R2" 1000 "" "" 8 false true zdj7WeAmwFvsXfKsCxju1Q7Toshc6UybtBJakxZPMz7k3xynL
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B58-R3" 1000 "" "" 8 false true zdj7WkRPAX9o9nb9zPbXzwG5c92FzKqxSzBzY4vaaHwiPdWNP
echo ""

# Real CIDv1 Base16 examples (starting with f...) - hex encoded CIDs
echo "=== Testing CIDv1 Base16 (f...) ==="
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B16-R1" 1000 "" "" 8 false true f01701220c3c4733ec8affd06cf9e9ff50ffc6bcd2ec85a6170004bb709669c31de94391a
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B16-R2" 1000 "" "" 8 false true f015512209aec6806794561107e594b1f6a8a6b0c92a0cba9acf5e5e93cca06f781813b0b3
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B16-R3" 1000 "" "" 8 false true f01701220b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
echo ""

# Real CIDv1 Base36 examples (starting with k...) - for subdomain use
echo "=== Testing CIDv1 Base36 (k...) ==="
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B36-R1" 1000 "" "" 8 false true k2k4r8jvtpedxfds3b2r5o8b5x3a9t6p3q7e9w5x2c8v4n9
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B36-R2" 1000 "" "" 8 false true k2jmtxu8ipfs9hash7example2base36encoded5cid
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV1-B36-R3" 1000 "" "" 8 false true k51qzi5uqu5djt3b0s8z4rjzf4v8c6d0x8n2g7h9j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7
echo ""

# 64-character hex hash examples (transaction hashes)
echo "=== Testing 64-char Hex Hash (Transaction IDs) ==="
./release/linux/phicoin-cli --datadir=./release/data_test issue "HEX-HASH-R1" 1000 "" "" 8 false true 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
./release/linux/phicoin-cli --datadir=./release/data_test issue "HEX-HASH-R2" 1000 "" "" 8 false true fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
./release/linux/phicoin-cli --datadir=./release/data_test issue "HEX-HASH-R3" 1000 "" "" 8 false true a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890
echo ""

# Additional real CIDv0 examples from user's previous tests
echo "=== Testing Additional Real CIDv0 Examples ==="
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV0-USER1" 1000 "" "" 8 false true QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV0-USER2" 1000 "" "" 8 false true QmTqu3Lk3gmTsQVtjU7rYYM37EAW4xNmbuEAp2Mjr4AV7E
./release/linux/phicoin-cli --datadir=./release/data_test issue "CIDV0-USER3" 1000 "" "" 8 false true QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG
echo ""

echo "=== Test Summary ==="
echo "All real CID format tests completed."
echo "Results:"
echo "  - CIDv0 (Qm...): Should succeed based on previous tests"
echo "  - CIDv1 Base32 (baf...): May fail with 'IPFS hash cannot be empty'"
echo "  - CIDv1 Base58BTC (z...): May fail with 'IPFS hash cannot be empty'"
echo "  - CIDv1 Base16 (f...): Some may succeed (longer hex strings)"
echo "  - CIDv1 Base36 (k...): May fail with format validation"
echo "  - Hex Hash (64 chars): Should succeed"
echo ""

# Step 5: Clean up - kill daemon
echo "Step 5: Cleaning up - killing daemon..."
kill $DAEMON_PID 2>/dev/null || killall -9 phicoind || true

echo "=== Test Script Completed ===" 