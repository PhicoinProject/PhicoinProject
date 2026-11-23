// Copyright (c) 2017 The Bitcoin Core developers
// Copyright (c) @2024 The PHICOIN Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef PHICOIN_FS_H
#define PHICOIN_FS_H

#include <stdio.h>
#include <string>

// Force boost filesystem v3 for compatibility with boost 1.71
#ifndef BOOST_FILESYSTEM_VERSION
#define BOOST_FILESYSTEM_VERSION 3
#endif

#include <boost/filesystem.hpp>
#include <boost/filesystem/fstream.hpp>

#ifdef WIN32
#include <boost/filesystem/detail/utf8_codecvt_facet.hpp>
#endif

/** Filesystem operations and types */
namespace fs = boost::filesystem;

/** Bridge operations to C stdio */
namespace fsbridge {
    FILE *fopen(const fs::path& p, const char *mode);
    FILE *freopen(const fs::path& p, const char *mode, FILE *stream);
};

#endif // PHICOIN_FS_H
