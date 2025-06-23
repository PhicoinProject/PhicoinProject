// Copyright (c) @2024 The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef PHICOIN_CID_PARSER_H
#define PHICOIN_CID_PARSER_H

#include <string>
#include <vector>
#include <map>

// CID version constants
const uint8_t CID_VERSION_0 = 0;
const uint8_t CID_VERSION_1 = 1;

// Multibase encoding constants
const char MULTIBASE_BASE16_LOWER = 'f';
const char MULTIBASE_BASE16_UPPER = 'F';
const char MULTIBASE_BASE32 = 'b';
const char MULTIBASE_BASE32_HEX = 'v';
const char MULTIBASE_BASE36 = 'k';
const char MULTIBASE_BASE58_BTC = 'z';
const char MULTIBASE_BASE64 = 'm';
const char MULTIBASE_BASE64_URL = 'u';

// Multicodec constants for common IPFS usage
const uint64_t MULTICODEC_DAG_PB = 0x70;
const uint64_t MULTICODEC_DAG_CBOR = 0x71;
const uint64_t MULTICODEC_DAG_JSON = 0x0129;
const uint64_t MULTICODEC_RAW = 0x55;

// Multihash constants
const uint64_t MULTIHASH_SHA2_256 = 0x12;
const uint8_t MULTIHASH_SHA2_256_LENGTH = 32;

struct CIDComponents {
    uint8_t version;
    uint64_t multicodec;
    uint64_t multihash_type;
    uint8_t multihash_length;
    std::vector<uint8_t> hash_digest;
    char multibase_encoding; // Only for CIDv1
    bool is_valid;
    
    CIDComponents() : version(0), multicodec(0), multihash_type(0), 
                     multihash_length(0), multibase_encoding(0), is_valid(false) {}
};

class CIDParser {
public:
    // Parse a CID string into its components
    static CIDComponents ParseCID(const std::string& cid_string);
    
    // Validate a CID string
    static bool IsValidCID(const std::string& cid_string);
    
    // Convert CID to binary format for storage
    static std::vector<uint8_t> CIDToBinary(const std::string& cid_string);
    
    // Convert binary format back to CID string
    static std::string BinaryToCID(const std::vector<uint8_t>& binary_data, char multibase_encoding = MULTIBASE_BASE32);
    
    // Check if string is CIDv0 format
    static bool IsCIDv0(const std::string& cid_string);
    
    // Check if string is CIDv1 format
    static bool IsCIDv1(const std::string& cid_string);
    
    // Convert CIDv0 to CIDv1
    static std::string ConvertCIDv0ToCIDv1(const std::string& cidv0, char multibase_encoding = MULTIBASE_BASE32);
    
    // Convert CIDv1 to CIDv0 (if possible)
    static std::string ConvertCIDv1ToCIDv0(const std::string& cidv1);
    
    // Get canonical CID format for storage (always use base32 CIDv1)
    static std::string GetCanonicalCID(const std::string& cid_string);

private:
    // Helper functions for multibase encoding/decoding
    static std::vector<uint8_t> DecodeMultibase(const std::string& encoded, char& encoding);
    static std::string EncodeMultibase(const std::vector<uint8_t>& data, char encoding);
    
    // Helper functions for varint encoding/decoding
    static uint64_t DecodeVarint(const std::vector<uint8_t>& data, size_t& offset);
    static std::vector<uint8_t> EncodeVarint(uint64_t value);
    
    // Base encoding/decoding functions
    static std::vector<uint8_t> DecodeBase16(const std::string& encoded);
    static std::string EncodeBase16(const std::vector<uint8_t>& data, bool uppercase = false);
    
    static std::vector<uint8_t> DecodeBase32(const std::string& encoded);
    static std::string EncodeBase32(const std::vector<uint8_t>& data);
    
    static std::vector<uint8_t> DecodeBase36(const std::string& encoded);
    static std::string EncodeBase36(const std::vector<uint8_t>& data);
    
    // Use existing PHICOIN DecodeBase58 function (declared in base58.h)
    // static std::vector<uint8_t> DecodeBase58(const std::string& encoded);
    static std::string EncodeBase58(const std::vector<uint8_t>& data);
    
    static std::vector<uint8_t> DecodeBase64(const std::string& encoded, bool url_safe = false);
    static std::string EncodeBase64(const std::vector<uint8_t>& data, bool url_safe = false);
    
    // Validation helpers
    static bool IsValidMulticodec(uint64_t multicodec);
    static bool IsValidMultihash(uint64_t multihash_type, uint8_t length);
};

// Convenience functions for asset system integration
namespace AssetCID {
    // Check if a string is a valid IPFS CID (v0 or v1)
    bool IsValidIPFSHash(const std::string& hash);
    
    // Normalize CID to canonical format for storage
    std::string NormalizeCID(const std::string& cid);
    
    // Convert CID to binary for blockchain storage
    std::vector<uint8_t> CIDToStorageFormat(const std::string& cid);
    
    // Convert binary storage format back to CID
    std::string StorageFormatToCID(const std::vector<uint8_t>& storage_data);
    
    // Get display format of CID (user-friendly)
    std::string GetDisplayCID(const std::string& cid);
}

#endif // PHICOIN_CID_PARSER_H 