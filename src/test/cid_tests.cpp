// Copyright (c) @2024 The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include "assets/cid_parser.h"
#include "test/test_phicoin.h"

#include <boost/test/unit_test.hpp>
#include <string>
#include <vector>

BOOST_FIXTURE_TEST_SUITE(cid_tests, BasicTestingSetup)

BOOST_AUTO_TEST_CASE(test_cidv0_validation)
{
    // Valid CIDv0 examples
    BOOST_CHECK(CIDParser::IsCIDv0("QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51"));
    BOOST_CHECK(CIDParser::IsCIDv0("QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o"));
    BOOST_CHECK(CIDParser::IsCIDv0("QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"));
    
    // Invalid CIDv0 examples
    BOOST_CHECK(!CIDParser::IsCIDv0("QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh5")); // Too short
    BOOST_CHECK(!CIDParser::IsCIDv0("QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh511")); // Too long
    BOOST_CHECK(!CIDParser::IsCIDv0("AmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51")); // Wrong prefix
    BOOST_CHECK(!CIDParser::IsCIDv0("QNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51")); // Wrong prefix
    BOOST_CHECK(!CIDParser::IsCIDv0("")); // Empty string
}

BOOST_AUTO_TEST_CASE(test_cidv1_validation)
{
    // Valid CIDv1 examples (base32)
    BOOST_CHECK(CIDParser::IsCIDv1("bafybeif2pall7dybz7vecqka3zo24irdwabf7zgh4ywwlzway323anme5i"));
    BOOST_CHECK(CIDParser::IsCIDv1("bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei4"));
    BOOST_CHECK(CIDParser::IsCIDv1("bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"));
    
    // Valid CIDv1 examples (base58btc)
    BOOST_CHECK(CIDParser::IsCIDv1("z36UQrhVx5ZoKhVYaJ9R61tBD5mHmvHzZAP"));
    
    // Valid CIDv1 examples (base16)
    BOOST_CHECK(CIDParser::IsCIDv1("f01701220c05b4d5a8ac5b9e7b24ad5c1d3a5c9f58a7f5e0d9c5b85e4d7c8e4b3"));
    
    // Invalid CIDv1 examples
    BOOST_CHECK(!CIDParser::IsCIDv1("xyz123")); // Invalid multibase prefix
    BOOST_CHECK(!CIDParser::IsCIDv1("b123")); // Too short
    BOOST_CHECK(!CIDParser::IsCIDv1("")); // Empty string
}

BOOST_AUTO_TEST_CASE(test_cid_parsing)
{
    // Test CIDv0 parsing
    std::string cidv0 = "QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51";
    CIDComponents components = CIDParser::ParseCID(cidv0);
    
    BOOST_CHECK(components.is_valid);
    BOOST_CHECK_EQUAL(components.version, 0);
    BOOST_CHECK_EQUAL(components.multicodec, MULTICODEC_DAG_PB);
    BOOST_CHECK_EQUAL(components.multihash_type, MULTIHASH_SHA2_256);
    BOOST_CHECK_EQUAL(components.multihash_length, MULTIHASH_SHA2_256_LENGTH);
    BOOST_CHECK_EQUAL(components.hash_digest.size(), 32);
    
    // Test invalid CID parsing
    CIDComponents invalid_components = CIDParser::ParseCID("invalid_cid");
    BOOST_CHECK(!invalid_components.is_valid);
}

BOOST_AUTO_TEST_CASE(test_cid_conversion)
{
    std::string cidv0 = "QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51";
    
    // Convert CIDv0 to CIDv1
    std::string cidv1 = CIDParser::ConvertCIDv0ToCIDv1(cidv0, MULTIBASE_BASE32);
    BOOST_CHECK(!cidv1.empty());
    BOOST_CHECK(CIDParser::IsCIDv1(cidv1));
    
    // Convert back to CIDv0
    std::string converted_back = CIDParser::ConvertCIDv1ToCIDv0(cidv1);
    BOOST_CHECK_EQUAL(converted_back, cidv0);
    
    // Test invalid conversion
    std::string invalid_conversion = CIDParser::ConvertCIDv0ToCIDv1("invalid_cid");
    BOOST_CHECK(invalid_conversion.empty());
}

BOOST_AUTO_TEST_CASE(test_cid_binary_conversion)
{
    std::string cid = "QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51";
    
    // Convert to binary
    std::vector<uint8_t> binary = CIDParser::CIDToBinary(cid);
    BOOST_CHECK(!binary.empty());
    
    // Convert back to CID
    std::string restored_cid = CIDParser::BinaryToCID(binary, MULTIBASE_BASE58_BTC);
    BOOST_CHECK_EQUAL(restored_cid, cid);
    
    // Test with empty input
    std::vector<uint8_t> empty_binary = CIDParser::CIDToBinary("");
    BOOST_CHECK(empty_binary.empty());
}

BOOST_AUTO_TEST_CASE(test_asset_cid_functions)
{
    // Test valid IPFS hash validation
    BOOST_CHECK(AssetCID::IsValidIPFSHash("QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51"));
    BOOST_CHECK(AssetCID::IsValidIPFSHash("bafybeif2pall7dybz7vecqka3zo24irdwabf7zgh4ywwlzway323anme5i"));
    
    // Test invalid IPFS hash validation
    BOOST_CHECK(!AssetCID::IsValidIPFSHash(""));
    BOOST_CHECK(!AssetCID::IsValidIPFSHash("invalid_hash"));
    BOOST_CHECK(!AssetCID::IsValidIPFSHash("QmTooShort"));
    
    // Test normalization
    std::string cidv0 = "QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51";
    std::string normalized = AssetCID::NormalizeCID(cidv0);
    BOOST_CHECK(!normalized.empty());
    BOOST_CHECK(CIDParser::IsCIDv1(normalized)); // Should convert to CIDv1
    
    // Test storage format conversion
    std::vector<uint8_t> storage_format = AssetCID::CIDToStorageFormat(cidv0);
    BOOST_CHECK(!storage_format.empty());
    
    std::string restored = AssetCID::StorageFormatToCID(storage_format);
    BOOST_CHECK(!restored.empty());
    BOOST_CHECK(AssetCID::IsValidIPFSHash(restored));
    
    // Test display format
    std::string display = AssetCID::GetDisplayCID(normalized);
    BOOST_CHECK(!display.empty());
}

BOOST_AUTO_TEST_CASE(test_multibase_encoding)
{
    std::vector<uint8_t> test_data = {0x01, 0x02, 0x03, 0x04, 0x05};
    
    // Test base32 encoding/decoding
    std::string base32_encoded = CIDParser::EncodeMultibase(test_data, MULTIBASE_BASE32);
    BOOST_CHECK(!base32_encoded.empty());
    BOOST_CHECK_EQUAL(base32_encoded[0], MULTIBASE_BASE32);
    
    char encoding;
    std::vector<uint8_t> base32_decoded = CIDParser::DecodeMultibase(base32_encoded, encoding);
    BOOST_CHECK_EQUAL(encoding, MULTIBASE_BASE32);
    BOOST_CHECK_EQUAL_COLLECTIONS(test_data.begin(), test_data.end(),
                                 base32_decoded.begin(), base32_decoded.end());
    
    // Test base58btc encoding/decoding
    std::string base58_encoded = CIDParser::EncodeMultibase(test_data, MULTIBASE_BASE58_BTC);
    BOOST_CHECK(!base58_encoded.empty());
    BOOST_CHECK_EQUAL(base58_encoded[0], MULTIBASE_BASE58_BTC);
    
    std::vector<uint8_t> base58_decoded = CIDParser::DecodeMultibase(base58_encoded, encoding);
    BOOST_CHECK_EQUAL(encoding, MULTIBASE_BASE58_BTC);
    BOOST_CHECK_EQUAL_COLLECTIONS(test_data.begin(), test_data.end(),
                                 base58_decoded.begin(), base58_decoded.end());
}

BOOST_AUTO_TEST_CASE(test_varint_encoding)
{
    // Test small values
    uint64_t value1 = 127;
    std::vector<uint8_t> encoded1 = CIDParser::EncodeVarint(value1);
    BOOST_CHECK_EQUAL(encoded1.size(), 1);
    BOOST_CHECK_EQUAL(encoded1[0], 127);
    
    size_t offset1 = 0;
    uint64_t decoded1 = CIDParser::DecodeVarint(encoded1, offset1);
    BOOST_CHECK_EQUAL(decoded1, value1);
    BOOST_CHECK_EQUAL(offset1, 1);
    
    // Test larger values
    uint64_t value2 = 16384;
    std::vector<uint8_t> encoded2 = CIDParser::EncodeVarint(value2);
    BOOST_CHECK(encoded2.size() > 1);
    
    size_t offset2 = 0;
    uint64_t decoded2 = CIDParser::DecodeVarint(encoded2, offset2);
    BOOST_CHECK_EQUAL(decoded2, value2);
    
    // Test zero
    uint64_t value3 = 0;
    std::vector<uint8_t> encoded3 = CIDParser::EncodeVarint(value3);
    BOOST_CHECK_EQUAL(encoded3.size(), 1);
    BOOST_CHECK_EQUAL(encoded3[0], 0);
    
    size_t offset3 = 0;
    uint64_t decoded3 = CIDParser::DecodeVarint(encoded3, offset3);
    BOOST_CHECK_EQUAL(decoded3, value3);
}

BOOST_AUTO_TEST_CASE(test_canonical_cid)
{
    // Test canonical CID generation
    std::string cidv0 = "QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh5K1rhAQKCh51";
    std::string canonical = CIDParser::GetCanonicalCID(cidv0);
    
    BOOST_CHECK(!canonical.empty());
    BOOST_CHECK(CIDParser::IsCIDv1(canonical));
    BOOST_CHECK_EQUAL(canonical[0], MULTIBASE_BASE32); // Should be base32 encoded
    
    // Test that the canonical form is consistent
    std::string canonical2 = CIDParser::GetCanonicalCID(canonical);
    BOOST_CHECK_EQUAL(canonical, canonical2);
    
    // Test invalid input
    std::string invalid_canonical = CIDParser::GetCanonicalCID("invalid_cid");
    BOOST_CHECK(invalid_canonical.empty());
}

BOOST_AUTO_TEST_SUITE_END() 