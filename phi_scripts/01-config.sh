#!/usr/bin/env bash

OS=${1}

PHICOINROOT=$(pwd)

# Redirect all output (including errors) to log file
LOG_FILE="${PHICOINROOT}/logs.01"
exec > >(tee -a "${LOG_FILE}") 2>&1


rm -rf autom4te.cache
./autogen.sh 


if [[ ! ${OS} ]]; then
    echo "Error: Invalid options"
    echo "Usage: ${0} <operating system>"
    exit 1
fi
echo "----------------------------------------"
echo "OS: ${OS}"
echo "----------------------------------------"

if [[ ${OS} == "arm32v7-disable-wallet" || ${OS} == "linux-disable-wallet" || ${OS} == "aarch64-disable-wallet" ]]; then
    OS=`echo ${OS} | cut -d"-" -f1`
fi

echo "----------------------------------------"
echo "Installing Berkeley DB 4.8"
echo "----------------------------------------"

# Install Berkeley DB using install_db4.sh (Ravencoin approach)
if [[ ${OS} == "linux" || ${OS} == "linux-disable-wallet" ]]; then
    if [ ! -d "${PHICOINROOT}/db4/lib" ] || [ ! -f "${PHICOINROOT}/db4/lib/libdb_cxx-4.8.a" ]; then
        echo "Installing Berkeley DB 4.8 to ${PHICOINROOT}/db4"
        ${PHICOINROOT}/contrib/install_db4.sh ${PHICOINROOT}
    else
        echo "Berkeley DB 4.8 already installed at ${PHICOINROOT}/db4"
    fi
fi

echo "----------------------------------------"
echo "Building Dependencies for ${OS}"
echo "----------------------------------------"

cd depends
if [[ ${OS} == "windows" ]]; then
    make HOST=x86_64-w64-mingw32 -j16
elif [[ ${OS} == "osx" ]]; then
    echo "OSX building is not currently enabled"
    exit 1
elif [[ ${OS} == "linux" || ${OS} == "linux-disable-wallet" ]]; then
    # Build core dependencies (boost, openssl, libevent, zeromq)
    # Note: Qt5 build is completely skipped - we use system Qt5 and bundle it for portability
    # Qt5 static build fails due to xcb dependency issues, and we don't need it
    echo "Building core dependencies (boost, openssl, libevent, zeromq)..."
    echo "Note: Qt5 build is skipped - using system Qt5 with bundling approach"
    
    # Build dependencies one by one (skip Qt5 completely)
    make HOST=x86_64-linux-gnu boost -j16 || true
    make HOST=x86_64-linux-gnu openssl -j16 || true
    make HOST=x86_64-linux-gnu libevent -j16 || true
    make HOST=x86_64-linux-gnu zeromq -j16 || true
    
    # Skip Qt5 build completely - we use system Qt5
    echo "Skipping Qt5 build in depends (using system Qt5 with bundling)"
    # Ensure boost static libraries are copied to correct location and create symlinks
    echo "Copying boost static libraries..."
    mkdir -p ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
    # Method 1: Extract from cached tar.gz
    BOOST_CACHE=$(ls ${PHICOINROOT}/depends/built/x86_64-linux-gnu/boost/boost-*.tar.gz 2>/dev/null | head -1)
    if [ -n "$BOOST_CACHE" ] && [ -f "$BOOST_CACHE" ]; then
        echo "Extracting boost libraries from cache: $BOOST_CACHE"
        cd ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
        # Extract all .a files, handle different path structures
        tar -xzf "$BOOST_CACHE" --wildcards "*/lib/*.a" 2>/dev/null || \
        tar -xzf "$BOOST_CACHE" --wildcards "lib/*.a" 2>/dev/null || \
        tar -xzf "$BOOST_CACHE" "*.a" 2>/dev/null || true
        # Move extracted files to current directory
        find . -name "*.a" -type f -exec mv {} . \; 2>/dev/null || true
        # Create symlinks
        for f in libboost_*-mt-s-x64.a libboost_*-s-x64.a libboost_*-mt.a; do
            if [ -f "$f" ]; then
                base=$(echo "$f" | sed -E 's/(-mt)?(-s)?(-x64)?\.a$//')
                if [ "$base" != "$f" ]; then
                    ln -sf "$f" "${base}.a" 2>/dev/null || true
                fi
            fi
        done
        echo "Boost static libraries extracted from cache"
    fi
    # Method 2: Copy from build directory (if exists)
    BOOST_BUILD=$(find ${PHICOINROOT}/depends/work/build/x86_64-linux-gnu/boost -type d -path "*/stage/lib" 2>/dev/null | head -1)
    if [ -n "$BOOST_BUILD" ] && [ -d "$BOOST_BUILD" ]; then
        cp -f "$BOOST_BUILD"/*.a ${PHICOINROOT}/depends/x86_64-linux-gnu/lib/ 2>/dev/null
        cd ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
        for f in libboost_*-mt-s-x64.a; do
            if [ -f "$f" ]; then
                base=$(echo "$f" | sed 's/-mt-s-x64\.a$//')
                ln -sf "$f" "${base}.a" 2>/dev/null || true
            fi
        done
        echo "Boost static libraries copied from build directory"
    fi
    # Ensure ZeroMQ static library is copied to correct location (depends version, no GSSAPI/NORM dependencies)
    echo "Copying ZeroMQ static library (depends version, fully static)..."
    mkdir -p ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
    
    # Use ensure_zeromq.sh script for reliable ZeroMQ build and copy
    if [ ! -f "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libzmq.a" ]; then
        echo "ZeroMQ not found in depends, ensuring it's built and copied..."
        bash ${PHICOINROOT}/phi_scripts/ensure_zeromq.sh
        if [ ! -f "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libzmq.a" ]; then
            echo "WARNING: depends ZeroMQ not found after ensure_zeromq.sh"
            echo "  Will use system ZeroMQ (will have dynamic dependencies)"
            echo "  For fully static build, check: depends/x86_64-linux-gnu/lib/libzmq.a"
        fi
    fi
elif [[ ${OS} == "arm32v7" || ${OS} == "arm32v7-disable-wallet" ]]; then
    make HOST=arm-linux-gnueabihf -j16
elif [[ ${OS} == "aarch64" || ${OS} == "aarch64-disable-wallet" ]]; then
    make HOST=aarch64-linux-gnu -j16
fi
