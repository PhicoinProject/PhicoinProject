#!/bin/bash

echo "=== PHICOIN CID Final Testing Script ==="
echo "Testing simplified IPFS storage (raw string, max 2048 bytes)"
echo ""

# Use fixed address
ADDRESS="PqnMucV7CSULLr7o4yKVZTQtKfDsMX6H4c"
echo "Using fixed address: $ADDRESS"
echo ""

# Generate random number for asset names
RANDOM_SUFFIX=$(date +%s%N | cut -b10-19)
echo "Random suffix for asset names: $RANDOM_SUFFIX"
echo ""

# Arrays to store transaction IDs, asset names, and expected IPFS hashes
declare -a TXIDS=()
declare -a ASSET_NAMES=()
declare -a EXPECTED_IPFS=()
declare -a TEST_DESCRIPTIONS=()

# Test various CID formats
echo "=== Testing CIDv0 (Base58, Qm...) ==="
ASSET_NAME="CIDV0-TEST-$RANDOM_SUFFIX"
EXPECTED_HASH="QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51"
ASSET_NAMES+=("$ASSET_NAME")
EXPECTED_IPFS+=("$EXPECTED_HASH")
TEST_DESCRIPTIONS+=("CIDv0 (Base58, Qm...)")
RESULT=$(./release/linux/phicoin-cli --datadir=./release/data_test issue "$ASSET_NAME" 1000 "$ADDRESS" "" 8 true true "$EXPECTED_HASH")
TXIDS+=("$RESULT")
echo "Asset: $ASSET_NAME, TXID: $RESULT"
echo ""

echo "=== Testing CIDv1 Base32 (baf...) ==="
ASSET_NAME="CIDV1-BASE32-$RANDOM_SUFFIX"
EXPECTED_HASH="bafkreiftwinma5mk6jzcracgvth6p4licjn3ff2wr3wicfcgup4unpvih6p"
ASSET_NAMES+=("$ASSET_NAME")
EXPECTED_IPFS+=("$EXPECTED_HASH")
TEST_DESCRIPTIONS+=("CIDv1 Base32 (baf...)")
RESULT=$(./release/linux/phicoin-cli --datadir=./release/data_test issue "$ASSET_NAME" 1000 "$ADDRESS" "" 8 true true "$EXPECTED_HASH")
TXIDS+=("$RESULT")
echo "Asset: $ASSET_NAME, TXID: $RESULT"
echo ""

echo "=== Testing CIDv1 Base58BTC (z...) ==="
ASSET_NAME="CIDV1-BASE58-$RANDOM_SUFFIX"
EXPECTED_HASH="zdj7WeAmwFvsXfKsCxju1Q7Toshc6UybtBJakxZPMz7k3xynL"
ASSET_NAMES+=("$ASSET_NAME")
EXPECTED_IPFS+=("$EXPECTED_HASH")
TEST_DESCRIPTIONS+=("CIDv1 Base58BTC (z...)")
RESULT=$(./release/linux/phicoin-cli --datadir=./release/data_test issue "$ASSET_NAME" 1000 "$ADDRESS" "" 8 true true "$EXPECTED_HASH")
TXIDS+=("$RESULT")
echo "Asset: $ASSET_NAME, TXID: $RESULT"
echo ""

echo "=== Testing CIDv1 Base16 (f...) ==="
ASSET_NAME="CIDV1-BASE16-$RANDOM_SUFFIX"
EXPECTED_HASH="f01701220c05b4d5a8ac5b9e7b24ad5c1d3a5c9f58a7f5e0d9c5b85e4d7c8e4b3"
ASSET_NAMES+=("$ASSET_NAME")
EXPECTED_IPFS+=("$EXPECTED_HASH")
TEST_DESCRIPTIONS+=("CIDv1 Base16 (f...)")
RESULT=$(./release/linux/phicoin-cli --datadir=./release/data_test issue "$ASSET_NAME" 1000 "$ADDRESS" "" 8 true true "$EXPECTED_HASH")
TXIDS+=("$RESULT")
echo "Asset: $ASSET_NAME, TXID: $RESULT"
echo ""

echo "=== Testing 64-char Hex Hash ==="
ASSET_NAME="HEX-HASH-$RANDOM_SUFFIX"
EXPECTED_HASH="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
ASSET_NAMES+=("$ASSET_NAME")
EXPECTED_IPFS+=("$EXPECTED_HASH")
TEST_DESCRIPTIONS+=("64-char Hex Hash")
RESULT=$(./release/linux/phicoin-cli --datadir=./release/data_test issue "$ASSET_NAME" 1000 "$ADDRESS" "" 8 true true "$EXPECTED_HASH")
TXIDS+=("$RESULT")
echo "Asset: $ASSET_NAME, TXID: $RESULT"
echo ""

echo "=== Testing Custom String ==="
ASSET_NAME="CUSTOM-STRING-$RANDOM_SUFFIX"
EXPECTED_HASH="MyCustomIPFSHashOrAnyString123"
ASSET_NAMES+=("$ASSET_NAME")
EXPECTED_IPFS+=("$EXPECTED_HASH")
TEST_DESCRIPTIONS+=("Custom String")
RESULT=$(./release/linux/phicoin-cli --datadir=./release/data_test issue "$ASSET_NAME" 1000 "$ADDRESS" "" 8 true true "$EXPECTED_HASH")
TXIDS+=("$RESULT")
echo "Asset: $ASSET_NAME, TXID: $RESULT"
echo ""

echo "=== Testing Long String (nearly 2048 bytes) ==="
ASSET_NAME="LONG-STRING-$RANDOM_SUFFIX"
LONG_STRING=$(printf "A%.0s" {1..2000})
EXPECTED_HASH="$LONG_STRING"
ASSET_NAMES+=("$ASSET_NAME")
EXPECTED_IPFS+=("$EXPECTED_HASH")
TEST_DESCRIPTIONS+=("Long String (2000 chars)")
RESULT=$(./release/linux/phicoin-cli --datadir=./release/data_test issue "$ASSET_NAME" 1000 "$ADDRESS" "" 8 true true "$EXPECTED_HASH")
TXIDS+=("$RESULT")
echo "Asset: $ASSET_NAME, TXID: $RESULT"
echo ""

echo "=== All assets issued, waiting 15 seconds for processing ==="
sleep 15

echo ""
echo "=== Verification Phase ==="
echo ""

echo "--- Checking mempool status ---"
MEMPOOL=$(./release/linux/phicoin-cli --datadir=./release/data_test getrawmempool)
echo "Mempool transactions: $MEMPOOL"
echo ""

echo "--- Detailed Asset Verification ---"
echo ""

# Function to extract IPFS hash from transaction data
extract_ipfs_from_tx() {
    local txid="$1"
    local expected_asset_name="$2"
    
    # Get raw transaction data
    local tx_data=$(./release/linux/phicoin-cli --datadir=./release/data_test getrawtransaction "$txid" 1 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        # Since jq is not available, use grep to find ipfs_hash
        # Look for the pattern "ipfs_hash": "value" in the transaction
        local ipfs_hash=$(echo "$tx_data" | grep -o '"ipfs_hash":"[^"]*"' | head -1 | sed 's/"ipfs_hash":"\([^"]*\)"/\1/')
        
        # If we found an IPFS hash, return it
        if [ -n "$ipfs_hash" ]; then
            echo "$ipfs_hash"
        fi
    fi
}

for i in "${!ASSET_NAMES[@]}"; do
    ASSET_NAME="${ASSET_NAMES[$i]}"
    # Clean TXID - remove array brackets and quotes
    TXID_RAW="${TXIDS[$i]}"
    TXID=$(echo "$TXID_RAW" | grep -o '[a-f0-9]\{64\}' | head -1)
    EXPECTED_HASH="${EXPECTED_IPFS[$i]}"
    TEST_DESC="${TEST_DESCRIPTIONS[$i]}"
    
    echo "🔍 Test #$((i+1)): $TEST_DESC"
    echo "   Asset Name: $ASSET_NAME"
    echo "   Transaction ID: $TXID"
    
    # Display expected IPFS hash with truncation for long strings
    if [ ${#EXPECTED_HASH} -gt 100 ]; then
        DISPLAY_EXPECTED="${EXPECTED_HASH:0:50}...${EXPECTED_HASH: -20}"
        echo "   Expected IPFS: $DISPLAY_EXPECTED (${#EXPECTED_HASH} chars)"
    else
        echo "   Expected IPFS: $EXPECTED_HASH"
    fi
    echo ""
    
    # First try to get asset data (if confirmed)
    ASSET_DATA=$(./release/linux/phicoin-cli --datadir=./release/data_test getassetdata "$ASSET_NAME" 2>/dev/null)
    ACTUAL_IPFS=""
    
    if [ $? -eq 0 ] && [ -n "$ASSET_DATA" ]; then
        echo "   ✅ Asset confirmed in blockchain"
        
        # Extract IPFS hash from asset data - fix the regex pattern
        ACTUAL_IPFS=$(echo "$ASSET_DATA" | grep -o '"ipfs_hash": *"[^"]*"' | sed 's/"ipfs_hash": *"\([^"]*\)"/\1/')
        
        echo "   📊 Asset Data Source: Blockchain (confirmed)"
        
    else
        echo "   ⏳ Asset pending confirmation, checking transaction..."
        
        # Extract IPFS from transaction
        ACTUAL_IPFS=$(extract_ipfs_from_tx "$TXID" "$ASSET_NAME")
        
        if [ -n "$ACTUAL_IPFS" ]; then
            echo "   ✅ Transaction found with asset data"
            echo "   📊 Asset Data Source: Transaction (unconfirmed)"
        else
            echo "   ❌ Transaction not found or no IPFS data"
        fi
    fi
    
    # Display and compare IPFS hashes
    if [ -n "$ACTUAL_IPFS" ]; then
        # Display actual IPFS hash with truncation for long strings
        if [ ${#ACTUAL_IPFS} -gt 100 ]; then
            DISPLAY_ACTUAL="${ACTUAL_IPFS:0:50}...${ACTUAL_IPFS: -20}"
            echo "   Actual IPFS:   $DISPLAY_ACTUAL (${#ACTUAL_IPFS} chars)"
        else
            echo "   Actual IPFS:   $ACTUAL_IPFS"
        fi
        
        # Compare IPFS hashes
        if [ "$EXPECTED_HASH" = "$ACTUAL_IPFS" ]; then
            echo "   ✅ IPFS Hash Match: PERFECT ✨"
        else
            echo "   ❌ IPFS Hash Mismatch!"
            echo "      Expected length: ${#EXPECTED_HASH}"
            echo "      Actual length:   ${#ACTUAL_IPFS}"
            
            # Show first few characters comparison for debugging
            if [ ${#EXPECTED_HASH} -gt 20 ] && [ ${#ACTUAL_IPFS} -gt 20 ]; then
                echo "      First 20 chars:"
                echo "        Expected: ${EXPECTED_HASH:0:20}..."
                echo "        Actual:   ${ACTUAL_IPFS:0:20}..."
            fi
            
            # Show last few characters comparison for debugging
            if [ ${#EXPECTED_HASH} -gt 20 ] && [ ${#ACTUAL_IPFS} -gt 20 ]; then
                echo "      Last 20 chars:"
                echo "        Expected: ...${EXPECTED_HASH: -20}"
                echo "        Actual:   ...${ACTUAL_IPFS: -20}"
            fi
        fi
    else
        echo "   ❌ No IPFS hash found in transaction or asset data"
    fi
    
    echo ""
    echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
done

echo ""
echo "--- Summary Report ---"
SUCCESS_COUNT=0
TOTAL_COUNT=${#ASSET_NAMES[@]}

for i in "${!ASSET_NAMES[@]}"; do
    ASSET_NAME="${ASSET_NAMES[$i]}"
    TEST_DESC="${TEST_DESCRIPTIONS[$i]}"
    TXID_RAW="${TXIDS[$i]}"
    TXID=$(echo "$TXID_RAW" | grep -o '[a-f0-9]\{64\}' | head -1)
    
    # Try asset data first, then transaction
    ASSET_DATA=$(./release/linux/phicoin-cli --datadir=./release/data_test getassetdata "$ASSET_NAME" 2>/dev/null)
    ACTUAL_IPFS=""
    
    if [ $? -eq 0 ] && [ -n "$ASSET_DATA" ]; then
        # Extract IPFS hash from asset data - fix the regex pattern  
        ACTUAL_IPFS=$(echo "$ASSET_DATA" | grep -o '"ipfs_hash": *"[^"]*"' | sed 's/"ipfs_hash": *"\([^"]*\)"/\1/')
    else
        ACTUAL_IPFS=$(extract_ipfs_from_tx "$TXID" "$ASSET_NAME")
    fi
    
    if [ -n "$ACTUAL_IPFS" ] && [ "$ACTUAL_IPFS" = "${EXPECTED_IPFS[$i]}" ]; then
        echo "✅ $TEST_DESC: SUCCESS"
        ((SUCCESS_COUNT++))
    elif [ -n "$ACTUAL_IPFS" ]; then
        echo "❌ $TEST_DESC: IPFS MISMATCH"
    else
        echo "❌ $TEST_DESC: NO IPFS DATA FOUND"
    fi
done

echo ""
echo "📈 Final Results: $SUCCESS_COUNT/$TOTAL_COUNT tests passed"
if [ $SUCCESS_COUNT -eq $TOTAL_COUNT ]; then
    echo "🎉 ALL TESTS PASSED! IPFS hash storage working perfectly!"
else
    echo "⚠️  Some tests failed. Check the details above."
fi

echo ""
echo "--- Additional Information ---"
echo "Block count: $(./release/linux/phicoin-cli --datadir=./release/data_test getblockcount)"
echo "Mempool size: $(./release/linux/phicoin-cli --datadir=./release/data_test getrawmempool | jq '. | length' 2>/dev/null || echo 'N/A')"
echo "Best block hash: $(./release/linux/phicoin-cli --datadir=./release/data_test getbestblockhash)"
echo ""

echo "=== Test completed ==="
echo "Created assets with suffix: $RANDOM_SUFFIX"
echo "Total assets tested: $TOTAL_COUNT"
echo "Success rate: $SUCCESS_COUNT/$TOTAL_COUNT ($(( SUCCESS_COUNT * 100 / TOTAL_COUNT ))%)" 