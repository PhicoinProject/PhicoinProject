#!/bin/bash
# Force build and copy ZeroMQ for fully static compilation

PHICOINROOT=$(cd "$(dirname "$0")/.." && pwd)
ZMQ_TARGET="${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libzmq.a"

echo "=== Ensuring ZeroMQ is built and copied ==="

# Force rebuild ZeroMQ
cd "${PHICOINROOT}/depends"
rm -rf work/build/x86_64-linux-gnu/zeromq work/staging/x86_64-linux-gnu/zeromq built/x86_64-linux-gnu/zeromq
echo "Building ZeroMQ..."
make HOST=x86_64-linux-gnu zeromq -j16

# Wait for filesystem sync and caching
sleep 3

# Copy from nested staging path (libtool install location)
echo "Copying ZeroMQ library..."
ZMQ_COPIED=0

# Method 1: Check cached location (after depends caching)
ZMQ_CACHED=$(find "${PHICOINROOT}/depends/built/x86_64-linux-gnu/zeromq" -name "libzmq.a" -type f 2>/dev/null | head -1)
if [ -n "$ZMQ_CACHED" ] && [ -f "$ZMQ_CACHED" ]; then
    mkdir -p "${PHICOINROOT}/depends/x86_64-linux-gnu/lib"
    cp "$ZMQ_CACHED" "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/"
    echo "✅ Copied from cache: $ZMQ_CACHED"
    ZMQ_COPIED=1
fi

# Method 2: Find any libzmq.a in staging (simplified pattern)
if [ "$ZMQ_COPIED" -eq 0 ]; then
    ZMQ_STAGING=$(find "${PHICOINROOT}/depends/work/staging/x86_64-linux-gnu/zeromq" -name "libzmq.a" -type f 2>/dev/null | head -1)
    if [ -n "$ZMQ_STAGING" ] && [ -f "$ZMQ_STAGING" ]; then
        mkdir -p "${PHICOINROOT}/depends/x86_64-linux-gnu/lib"
        cp "$ZMQ_STAGING" "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/"
        echo "✅ Copied from staging: $ZMQ_STAGING"
        ZMQ_COPIED=1
    fi
fi

# Method 3: Build directory
if [ "$ZMQ_COPIED" -eq 0 ]; then
    ZMQ_BUILD=$(find "${PHICOINROOT}/depends/work/build/x86_64-linux-gnu/zeromq" -path "*/src/.libs/libzmq.a" -type f 2>/dev/null | head -1)
    if [ -n "$ZMQ_BUILD" ] && [ -f "$ZMQ_BUILD" ]; then
        mkdir -p "${PHICOINROOT}/depends/x86_64-linux-gnu/lib"
        cp "$ZMQ_BUILD" "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/"
        echo "✅ Copied from build: $ZMQ_BUILD"
        ZMQ_COPIED=1
    fi
fi

cd "${PHICOINROOT}"

# Verify
if [ -f "$ZMQ_TARGET" ]; then
    echo "✅ ZeroMQ successfully copied: $ZMQ_TARGET"
    ls -lh "$ZMQ_TARGET"
    exit 0
else
    echo "❌ ERROR: Failed to copy ZeroMQ library"
    echo "Searching all locations:"
    find "${PHICOINROOT}/depends/work" -name "libzmq.a" -type f 2>/dev/null | head -5
    exit 1
fi
