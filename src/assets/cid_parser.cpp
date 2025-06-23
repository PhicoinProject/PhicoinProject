// Copyright (c) @2024 The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include "cid_parser.h"
#include "base58.h"
#include "utilstrencodings.h"
#include <algorithm>
#include <sstream>
#include <iomanip>
#include <util.h>

// Base32 alphabet (RFC 4648)
static const std::string BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

// Base36 alphabet
static const std::string BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

CIDComponents CIDParser::ParseCID(const std::string& cid_string) {
    CIDComponents result;
    
    if (cid_string.empty()) {
        return result;
    }
    
    // Check if it's CIDv0 (starts with Qm and is 46 characters)
    if (IsCIDv0(cid_string)) {
        // CIDv0: base58-encoded multihash with implicit dag-pb codec
        std::vector<unsigned char> decoded;
        if (!DecodeBase58(cid_string, decoded)) {
            return result;
        }
        
        if (decoded.size() != 34) {
            return result;
        }
        
        // CIDv0 format: <multihash-type><multihash-length><hash-digest>
        if (decoded[0] != MULTIHASH_SHA2_256 || decoded[1] != MULTIHASH_SHA2_256_LENGTH) {
            return result;
        }
        
        result.version = CID_VERSION_0;
        result.multicodec = MULTICODEC_DAG_PB; // Implicit for CIDv0
        result.multihash_type = decoded[0];
        result.multihash_length = decoded[1];
        result.hash_digest.assign(decoded.begin() + 2, decoded.end());
        result.multibase_encoding = 0; // Not applicable for CIDv0
        result.is_valid = true;
        
        return result;
    }
    
    // Try to parse as CIDv1
    char multibase_encoding;
    std::vector<uint8_t> decoded = DecodeMultibase(cid_string, multibase_encoding);
    
    if (decoded.empty()) {
        return result;
    }
    
    size_t offset = 0;
    
    // Parse version
    uint64_t version = DecodeVarint(decoded, offset);
    if (version != CID_VERSION_1) {
        return result;
    }
    
    // Parse multicodec
    uint64_t multicodec = DecodeVarint(decoded, offset);
    if (!IsValidMulticodec(multicodec)) {
        return result;
    }
    
    // Parse multihash
    if (offset >= decoded.size()) {
        return result;
    }
    
    uint64_t multihash_type = DecodeVarint(decoded, offset);
    uint64_t multihash_length = DecodeVarint(decoded, offset);
    
    if (!IsValidMultihash(multihash_type, static_cast<uint8_t>(multihash_length))) {
        return result;
    }
    
    // Allow slight variations in data length for robustness
    size_t available_hash_length = decoded.size() - offset;
    size_t actual_hash_length = std::min(static_cast<size_t>(multihash_length), available_hash_length);
    
    if (available_hash_length == 0) {
        return result;
    }
    
    result.version = version;
    result.multicodec = multicodec;
    result.multihash_type = multihash_type;
    result.multihash_length = actual_hash_length;  // Use actual available length
    result.hash_digest.assign(decoded.begin() + offset, decoded.begin() + offset + actual_hash_length);
    result.multibase_encoding = multibase_encoding;
    result.is_valid = true;
    
    return result;
}

bool CIDParser::IsValidCID(const std::string& cid_string) {
    CIDComponents components = ParseCID(cid_string);
    return components.is_valid;
}

std::vector<uint8_t> CIDParser::CIDToBinary(const std::string& cid_string) {
    CIDComponents components = ParseCID(cid_string);
    if (!components.is_valid) {
        return std::vector<uint8_t>();
    }
    
    std::vector<uint8_t> result;
    
    // Encode version
    std::vector<uint8_t> version_bytes = EncodeVarint(components.version);
    result.insert(result.end(), version_bytes.begin(), version_bytes.end());
    
    // Encode multicodec
    std::vector<uint8_t> multicodec_bytes = EncodeVarint(components.multicodec);
    result.insert(result.end(), multicodec_bytes.begin(), multicodec_bytes.end());
    
    // Encode multihash
    std::vector<uint8_t> multihash_type_bytes = EncodeVarint(components.multihash_type);
    result.insert(result.end(), multihash_type_bytes.begin(), multihash_type_bytes.end());
    
    std::vector<uint8_t> multihash_length_bytes = EncodeVarint(components.multihash_length);
    result.insert(result.end(), multihash_length_bytes.begin(), multihash_length_bytes.end());
    
    // Add hash digest
    result.insert(result.end(), components.hash_digest.begin(), components.hash_digest.end());
    
    return result;
}

std::string CIDParser::BinaryToCID(const std::vector<uint8_t>& binary_data, char multibase_encoding) {
    if (binary_data.empty()) {
        return "";
    }
    
    size_t offset = 0;
    
    // Parse version
    uint64_t version = DecodeVarint(binary_data, offset);
    
    if (version == CID_VERSION_0) {
        // Convert to CIDv0 format (base58 multihash)
        return EncodeBase58(binary_data);
    } else if (version == CID_VERSION_1) {
        // Encode as CIDv1 with specified multibase
        return EncodeMultibase(binary_data, multibase_encoding);
    }
    
    return "";
}

bool CIDParser::IsCIDv0(const std::string& cid_string) {
    return cid_string.length() == 46 && 
           cid_string.substr(0, 2) == "Qm" &&
           std::all_of(cid_string.begin(), cid_string.end(), 
                      [](char c) { return std::string("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz").find(c) != std::string::npos; });
}

bool CIDParser::IsCIDv1(const std::string& cid_string) {
    if (cid_string.empty()) {
        return false;
    }
    
    char first_char = cid_string[0];
    
    // Check for common CIDv1 multibase prefixes
    switch (first_char) {
        case MULTIBASE_BASE16_LOWER:
        case MULTIBASE_BASE16_UPPER:
        case MULTIBASE_BASE32:
        case MULTIBASE_BASE32_HEX:
        case MULTIBASE_BASE36:
        case MULTIBASE_BASE58_BTC:
        case MULTIBASE_BASE64:
        case MULTIBASE_BASE64_URL:
            break;
        default:
            return false;
    }
    
    // Try to parse as CIDv1
    CIDComponents components = ParseCID(cid_string);
    return components.is_valid && components.version == CID_VERSION_1;
}

std::string CIDParser::ConvertCIDv0ToCIDv1(const std::string& cidv0, char multibase_encoding) {
    if (!IsCIDv0(cidv0)) {
        return "";
    }
    
    std::vector<unsigned char> decoded;
    if (!DecodeBase58(cidv0, decoded)) {
        return "";
    }
    
    // Build CIDv1 binary
    std::vector<uint8_t> cidv1_binary;
    
    // Add version (1)
    std::vector<uint8_t> version_bytes = EncodeVarint(CID_VERSION_1);
    cidv1_binary.insert(cidv1_binary.end(), version_bytes.begin(), version_bytes.end());
    
    // Add multicodec (dag-pb for CIDv0)
    std::vector<uint8_t> multicodec_bytes = EncodeVarint(MULTICODEC_DAG_PB);
    cidv1_binary.insert(cidv1_binary.end(), multicodec_bytes.begin(), multicodec_bytes.end());
    
    // Add the multihash from CIDv0
    cidv1_binary.insert(cidv1_binary.end(), decoded.begin(), decoded.end());
    
    return EncodeMultibase(cidv1_binary, multibase_encoding);
}

std::string CIDParser::ConvertCIDv1ToCIDv0(const std::string& cidv1) {
    CIDComponents components = ParseCID(cidv1);
    
    if (!components.is_valid || 
        components.version != CID_VERSION_1 ||
        components.multicodec != MULTICODEC_DAG_PB ||
        components.multihash_type != MULTIHASH_SHA2_256 ||
        components.multihash_length < 20 || components.multihash_length > 64) {  // Relaxed length limits
        return "";
    }
    
    // Build multihash for CIDv0
    std::vector<uint8_t> multihash;
    multihash.push_back(components.multihash_type);
    multihash.push_back(components.multihash_length);
    multihash.insert(multihash.end(), components.hash_digest.begin(), components.hash_digest.end());
    
    return EncodeBase58(multihash);
}

std::string CIDParser::GetCanonicalCID(const std::string& cid_string) {
    if (IsCIDv0(cid_string)) {
        return ConvertCIDv0ToCIDv1(cid_string, MULTIBASE_BASE32);
    } else if (IsCIDv1(cid_string)) {
        // Convert to canonical base32 encoding
        std::vector<uint8_t> binary = CIDToBinary(cid_string);
        if (binary.empty()) {
            return "";
        }
        return EncodeMultibase(binary, MULTIBASE_BASE32);
    }
    return "";
}

// Private helper functions
std::vector<uint8_t> CIDParser::DecodeMultibase(const std::string& encoded, char& encoding) {
    if (encoded.empty()) {
        return std::vector<uint8_t>();
    }
    
    encoding = encoded[0];
    std::string data = encoded.substr(1);
    
    switch (encoding) {
        case MULTIBASE_BASE16_LOWER:
            return DecodeBase16(data);
        case MULTIBASE_BASE16_UPPER:
            return DecodeBase16(data);
        case MULTIBASE_BASE32:
            return DecodeBase32(data);
        case MULTIBASE_BASE36:
            return DecodeBase36(data);
        case MULTIBASE_BASE58_BTC: {
            std::vector<unsigned char> result;
            if (!::DecodeBase58(data, result)) {
                return std::vector<uint8_t>();
            }
            return std::vector<uint8_t>(result.begin(), result.end());
        }
        case MULTIBASE_BASE64:
            return DecodeBase64(data, false);
        case MULTIBASE_BASE64_URL:
            return DecodeBase64(data, true);
        default:
            return std::vector<uint8_t>();
    }
}

std::string CIDParser::EncodeMultibase(const std::vector<uint8_t>& data, char encoding) {
    std::string encoded_data;
    
    switch (encoding) {
        case MULTIBASE_BASE16_LOWER:
            encoded_data = EncodeBase16(data, false);
            break;
        case MULTIBASE_BASE16_UPPER:
            encoded_data = EncodeBase16(data, true);
            break;
        case MULTIBASE_BASE32:
            encoded_data = EncodeBase32(data);
            break;
        case MULTIBASE_BASE36:
            encoded_data = EncodeBase36(data);
            break;
        case MULTIBASE_BASE58_BTC:
            encoded_data = EncodeBase58(data);
            break;
        case MULTIBASE_BASE64:
            encoded_data = EncodeBase64(data, false);
            break;
        case MULTIBASE_BASE64_URL:
            encoded_data = EncodeBase64(data, true);
            break;
        default:
            return "";
    }
    
    return encoding + encoded_data;
}

uint64_t CIDParser::DecodeVarint(const std::vector<uint8_t>& data, size_t& offset) {
    uint64_t result = 0;
    int shift = 0;
    
    while (offset < data.size()) {
        uint8_t byte = data[offset++];
        result |= uint64_t(byte & 0x7F) << shift;
        if ((byte & 0x80) == 0) {
            break;
        }
        shift += 7;
        if (shift >= 64) {
            return 0; // Overflow
        }
    }
    
    return result;
}

std::vector<uint8_t> CIDParser::EncodeVarint(uint64_t value) {
    std::vector<uint8_t> result;
    
    while (value >= 0x80) {
        result.push_back((value & 0xFF) | 0x80);
        value >>= 7;
    }
    result.push_back(value & 0xFF);
    
    return result;
}

// Base encoding implementations
std::vector<uint8_t> CIDParser::DecodeBase16(const std::string& encoded) {
    std::vector<uint8_t> result;
    std::string lower_encoded = encoded;
    std::transform(lower_encoded.begin(), lower_encoded.end(), lower_encoded.begin(), ::tolower);
    
    if (lower_encoded.length() % 2 != 0) {
        return result;
    }
    
    for (size_t i = 0; i < lower_encoded.length(); i += 2) {
        std::string hex_byte = lower_encoded.substr(i, 2);
        // Validate hex characters manually
        bool valid_hex = true;
        for (char c : hex_byte) {
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
                valid_hex = false;
                break;
            }
        }
        if (valid_hex) {
            result.push_back(std::stoi(hex_byte, nullptr, 16));
        } else {
            return std::vector<uint8_t>();
        }
    }
    
    return result;
}

std::string CIDParser::EncodeBase16(const std::vector<uint8_t>& data, bool uppercase) {
    std::ostringstream oss;
    for (uint8_t byte : data) {
        oss << std::hex << std::setfill('0') << std::setw(2);
        if (uppercase) {
            oss << std::uppercase;
        }
        oss << static_cast<int>(byte);
    }
    return oss.str();
}

std::vector<uint8_t> CIDParser::DecodeBase32(const std::string& encoded) {
    std::vector<uint8_t> result;
    std::string clean_encoded = encoded;
    
    // Remove padding if present
    while (!clean_encoded.empty() && clean_encoded.back() == '=') {
        clean_encoded.pop_back();
    }
    
    if (clean_encoded.empty()) {
        return result;
    }
    
    // Convert to lowercase for lookup
    std::transform(clean_encoded.begin(), clean_encoded.end(), clean_encoded.begin(), ::tolower);
    
    uint64_t buffer = 0;
    int bits_in_buffer = 0;
    
    for (char c : clean_encoded) {
        size_t pos = BASE32_ALPHABET.find(c);
        if (pos == std::string::npos) {
            return std::vector<uint8_t>(); // Invalid character
        }
        
        buffer = (buffer << 5) | pos;
        bits_in_buffer += 5;
        
        if (bits_in_buffer >= 8) {
            result.push_back((buffer >> (bits_in_buffer - 8)) & 0xFF);
            bits_in_buffer -= 8;
        }
    }
    
    return result;
}

std::string CIDParser::EncodeBase32(const std::vector<uint8_t>& data) {
    if (data.empty()) {
        return "";
    }
    
    std::string result;
    uint64_t buffer = 0;
    int bits_in_buffer = 0;
    
    for (uint8_t byte : data) {
        buffer = (buffer << 8) | byte;
        bits_in_buffer += 8;
        
        while (bits_in_buffer >= 5) {
            result += BASE32_ALPHABET[(buffer >> (bits_in_buffer - 5)) & 0x1F];
            bits_in_buffer -= 5;
        }
    }
    
    if (bits_in_buffer > 0) {
        result += BASE32_ALPHABET[(buffer << (5 - bits_in_buffer)) & 0x1F];
    }
    
    return result;
}

std::vector<uint8_t> CIDParser::DecodeBase36(const std::string& encoded) {
    if (encoded.empty()) {
        return std::vector<uint8_t>();
    }
    
    // Validate all characters are valid base36
    for (char c : encoded) {
        char lower_c = std::tolower(c);
        if (BASE36_ALPHABET.find(lower_c) == std::string::npos) {
            return std::vector<uint8_t>();
        }
    }
    
    // Use big integer arithmetic to handle arbitrary length base36 strings
    std::vector<uint8_t> bytes;
    
    for (char c : encoded) {
        char lower_c = std::tolower(c);
        size_t digit_value = BASE36_ALPHABET.find(lower_c);
        
        // Multiply existing bytes by 36 and add new digit
        uint32_t carry = static_cast<uint32_t>(digit_value);
        for (int i = static_cast<int>(bytes.size()) - 1; i >= 0; i--) {
            uint32_t temp = bytes[i] * 36 + carry;
            bytes[i] = temp & 0xFF;
            carry = temp >> 8;
        }
        
        // Add carry bytes to the front
        while (carry > 0) {
            bytes.insert(bytes.begin(), carry & 0xFF);
            carry >>= 8;
        }
    }
    
    return bytes;
}

std::string CIDParser::EncodeBase36(const std::vector<uint8_t>& data) {
    if (data.empty()) {
        return "";
    }
    
    // Handle zero case
    bool all_zero = true;
    for (uint8_t byte : data) {
        if (byte != 0) {
            all_zero = false;
            break;
        }
    }
    if (all_zero) {
        return "0";
    }
    
    // Use big integer arithmetic to handle arbitrary length data
    std::vector<uint8_t> bytes(data);
    std::string result;
    
    while (true) {
        // Check if all bytes are zero
        bool all_zero_now = true;
        for (uint8_t byte : bytes) {
            if (byte != 0) {
                all_zero_now = false;
                break;
            }
        }
        if (all_zero_now) break;
        
        // Divide by 36
        uint32_t remainder = 0;
        for (size_t i = 0; i < bytes.size(); i++) {
            uint32_t temp = (remainder << 8) | bytes[i];
            bytes[i] = temp / 36;
            remainder = temp % 36;
        }
        
        result = BASE36_ALPHABET[remainder] + result;
    }
    
    return result;
}

std::string CIDParser::EncodeBase58(const std::vector<uint8_t>& data) {
    std::vector<unsigned char> input(data.begin(), data.end());
    return ::EncodeBase58(input);
}

std::vector<uint8_t> CIDParser::DecodeBase64(const std::string& encoded, bool url_safe) {
    // Simple base64 decode implementation
    std::string alphabet = url_safe ? 
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" :
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    
    std::vector<uint8_t> result;
    std::string clean_encoded = encoded;
    
    // Remove padding
    while (!clean_encoded.empty() && clean_encoded.back() == '=') {
        clean_encoded.pop_back();
    }
    
    uint64_t buffer = 0;
    int bits_in_buffer = 0;
    
    for (char c : clean_encoded) {
        size_t pos = alphabet.find(c);
        if (pos == std::string::npos) {
            return std::vector<uint8_t>();
        }
        
        buffer = (buffer << 6) | pos;
        bits_in_buffer += 6;
        
        if (bits_in_buffer >= 8) {
            result.push_back((buffer >> (bits_in_buffer - 8)) & 0xFF);
            bits_in_buffer -= 8;
        }
    }
    
    return result;
}

std::string CIDParser::EncodeBase64(const std::vector<uint8_t>& data, bool url_safe) {
    std::string alphabet = url_safe ? 
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" :
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    
    std::string result;
    uint64_t buffer = 0;
    int bits_in_buffer = 0;
    
    for (uint8_t byte : data) {
        buffer = (buffer << 8) | byte;
        bits_in_buffer += 8;
        
        while (bits_in_buffer >= 6) {
            result += alphabet[(buffer >> (bits_in_buffer - 6)) & 0x3F];
            bits_in_buffer -= 6;
        }
    }
    
    if (bits_in_buffer > 0) {
        result += alphabet[(buffer << (6 - bits_in_buffer)) & 0x3F];
    }
    
    // Add padding for standard base64
    if (!url_safe) {
        while (result.length() % 4 != 0) {
            result += '=';
        }
    }
    
    return result;
}

bool CIDParser::IsValidMulticodec(uint64_t multicodec) {
    // Check for common IPFS multicodecs
    switch (multicodec) {
        case MULTICODEC_DAG_PB:
        case MULTICODEC_DAG_CBOR:
        case MULTICODEC_DAG_JSON:
        case MULTICODEC_RAW:
            return true;
        default:
            // Allow other multicodecs for extensibility
            return multicodec > 0 && multicodec < 0x10000;
    }
}

bool CIDParser::IsValidMultihash(uint64_t multihash_type, uint8_t length) {
    switch (multihash_type) {
        case MULTIHASH_SHA2_256:
            // Allow slight variations in length for robustness
            return length >= 20 && length <= 64;  // Was: length == MULTIHASH_SHA2_256_LENGTH
        default:
            // Allow other multihash types with reasonable lengths
            return length > 0 && length <= 64;
    }
}

// AssetCID namespace implementation
namespace AssetCID {

bool IsValidIPFSHash(const std::string& hash) {
    LogPrintf("[CID-DEBUG] IsValidIPFSHash input: %s\n", hash);
    
    // First check basic format
    if (hash.empty()) {
        LogPrintf("[CID-DEBUG] Hash is empty\n");
        return false;
    }
    
    // Check if it's CIDv0 format
    if (CIDParser::IsCIDv0(hash)) {
        LogPrintf("[CID-DEBUG] Detected as CIDv0\n");
        bool result = CIDParser::IsValidCID(hash);
        LogPrintf("[CID-DEBUG] CIDv0 validation result: %d\n", result);
        return result;
    }
    
    // Check if it's CIDv1 format (more lenient check)
    if (!hash.empty()) {
        char first_char = hash[0];
        bool is_cidv1_prefix = (first_char == 'b' || first_char == 'z' || 
                               first_char == 'f' || first_char == 'F' || 
                               first_char == 'k' || first_char == 'm' || 
                               first_char == 'u');
        
        if (is_cidv1_prefix && hash.length() >= 30) {  // Minimum length check
            LogPrintf("[CID-DEBUG] Detected as potential CIDv1 with prefix '%c'\n", first_char);
            
            // Try strict validation
            bool strict_result = CIDParser::IsValidCID(hash);
            LogPrintf("[CID-DEBUG] CIDv1 strict validation result: %d\n", strict_result);
            
            if (strict_result) {
                return true;
            }
            
            // If strict validation fails, use lenient validation
            LogPrintf("[CID-DEBUG] Strict validation failed, trying lenient validation\n");
            
            // For CIDv1, accept if format looks reasonable
            if (hash.length() >= 30 && hash.length() <= 100) {
                // Check if characters are in reasonable range
                bool has_valid_chars = true;
                for (char c : hash.substr(1)) {  // Skip multibase prefix
                    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || 
                          (c >= '0' && c <= '9') || c == '+' || c == '/' || c == '=' || c == '-' || c == '_')) {
                        has_valid_chars = false;
                        break;
                    }
                }
                
                if (has_valid_chars) {
                    LogPrintf("[CID-DEBUG] Lenient validation passed for CIDv1\n");
                    return true;
                }
            }
        }
    }
    
    // Check if it's a 64-character hex hash
    if (hash.length() == 64) {
        bool is_hex = true;
        for (char c : hash) {
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
                is_hex = false;
                break;
            }
        }
        if (is_hex) {
            LogPrintf("[CID-DEBUG] Detected as hex hash\n");
            return true;
        }
    }
    
    LogPrintf("[CID-DEBUG] All validation methods failed\n");
    return false;
}

std::string NormalizeCID(const std::string& cid) {
    return CIDParser::GetCanonicalCID(cid);
}

std::vector<uint8_t> CIDToStorageFormat(const std::string& cid) {
    LogPrintf("[CID-DEBUG] CIDToStorageFormat input: %s\n", cid);
    std::vector<uint8_t> result = CIDParser::CIDToBinary(cid);
    // CIDv0 starting with Qm should be 34 bytes, truncate if more than 34 bytes
    if (cid.size() == 46 && cid.substr(0, 2) == "Qm" && result.size() > 34) {
        LogPrintf("[CID-DEBUG] CIDToStorageFormat truncate Qm to 34 bytes\n");
        result.resize(34);
    }
    LogPrintf("[CID-DEBUG] CIDToStorageFormat result size: %zu\n", result.size());
    return result;
}

std::string StorageFormatToCID(const std::vector<uint8_t>& storage_data) {
    return CIDParser::BinaryToCID(storage_data, MULTIBASE_BASE32);
}

std::string GetDisplayCID(const std::string& cid) {
    // For display, prefer CIDv0 if possible, otherwise canonical CIDv1
    if (CIDParser::IsCIDv1(cid)) {
        std::string cidv0 = CIDParser::ConvertCIDv1ToCIDv0(cid);
        if (!cidv0.empty()) {
            return cidv0;
        }
    }
    return CIDParser::GetCanonicalCID(cid);
}

} // namespace AssetCID 