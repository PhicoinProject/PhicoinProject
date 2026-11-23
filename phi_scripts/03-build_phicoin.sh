#!/bin/bash

PHICOINROOT=$(pwd)
OS=$1

# find ./src -name '*.o' -type f -delete
# find ./src -name '*.a' -type f -delete
# find ./src -name '*.so' -type f -delete
# find ./src -name '*.dylib' -type f -delete

# make clean

# Ensure static linking is used
# Fully static compilation: all libraries are statically linked except system libraries libc and libm
# libc and libm remain dynamically linked to ensure compatibility with different Linux distributions
if [[ ${OS} == "windows" ]]; then
    export LDFLAGS="-static-libgcc -static-libstdc++"
else
    export LDFLAGS="-static-libgcc -static-libstdc++ -no-pie"
fi

if [[ ${OS} == "linux" || ${OS} == "linux-disable-wallet" ]]; then
    # Ensure ZeroMQ is built and copied before building
    if [ ! -f "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libzmq.a" ]; then
        echo "ZeroMQ not found, ensuring it's built and copied..."
        bash ${PHICOINROOT}/phi_scripts/ensure_zeromq.sh
        if [ ! -f "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libzmq.a" ]; then
            echo "ERROR: Failed to ensure ZeroMQ is available. Cannot continue."
            exit 1
        fi
    fi
    
    export LDFLAGS="-static-libgcc -static-libstdc++ -static -no-pie -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${PHICOINROOT}/db4/lib"
    # Force use of static libraries (full paths) in Makefile and force libtool static linking
    if [ -f src/Makefile ]; then
        # 1. Modify library variables to use full paths to static libraries
        sed -i "s|BOOST_LIBS = .*|BOOST_LIBS = /usr/lib/x86_64-linux-gnu/libboost_system.a /usr/lib/x86_64-linux-gnu/libboost_filesystem.a /usr/lib/x86_64-linux-gnu/libboost_program_options.a /usr/lib/x86_64-linux-gnu/libboost_thread.a /usr/lib/x86_64-linux-gnu/libboost_chrono.a|g" src/Makefile
        # SSL/CRYPTO: Use system static libraries (depends version does not exist)
        SSL_LIBS_VAL="/usr/lib/x86_64-linux-gnu/libssl.a /usr/lib/x86_64-linux-gnu/libcrypto.a"
        CRYPTO_LIBS_VAL="/usr/lib/x86_64-linux-gnu/libcrypto.a"
        # ZMQ: Try to copy ZeroMQ library from depends build directory
        if [ ! -f "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libzmq.a" ]; then
            # Method 1: Search nested paths in staging directory
            ZMQ_STAGING_LIB=$(find ${PHICOINROOT}/depends/work/staging/x86_64-linux-gnu/zeromq -name "libzmq.a" -type f 2>/dev/null | head -1)
            if [ -n "$ZMQ_STAGING_LIB" ] && [ -f "$ZMQ_STAGING_LIB" ]; then
                mkdir -p ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
                cp "$ZMQ_STAGING_LIB" ${PHICOINROOT}/depends/x86_64-linux-gnu/lib/
                echo "Copied ZeroMQ library from staging directory: $ZMQ_STAGING_LIB"
            else
                # Method 2: Search in build directory .libs
                ZMQ_BUILD_LIB=$(find ${PHICOINROOT}/depends/work/build/x86_64-linux-gnu/zeromq -path "*/src/.libs/libzmq.a" -type f 2>/dev/null | head -1)
                if [ -n "$ZMQ_BUILD_LIB" ] && [ -f "$ZMQ_BUILD_LIB" ]; then
                    mkdir -p ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
                    cp "$ZMQ_BUILD_LIB" ${PHICOINROOT}/depends/x86_64-linux-gnu/lib/
                    echo "Copied ZeroMQ library from build directory: $ZMQ_BUILD_LIB"
                fi
            fi
        fi
        # ZMQ: Prefer depends-built ZeroMQ (no GSSAPI/KRB5/NORM/PGM/sodium dependencies)
        # If not available, use system ZeroMQ (will have dynamic dependencies, but at least Event and other libraries are static)
        if [ -f "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libzmq.a" ]; then
            ZMQ_DEPS="${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libzmq.a"
            echo "Using depends ZeroMQ (fully static, no GSSAPI/NORM dependencies): $ZMQ_DEPS"
        else
            echo "WARNING: depends ZeroMQ not found, using system ZeroMQ"
            echo "  This will add dynamic dependencies (GSSAPI, NORM, sodium, PGM)"
            echo "  For fully static build, manually copy ZeroMQ after building:"
            echo "    cd depends && make HOST=x86_64-linux-gnu zeromq"
            echo "    find depends/work/staging/x86_64-linux-gnu/zeromq -name 'libzmq.a' -exec cp {} depends/x86_64-linux-gnu/lib/ \\;"
            ZMQ_DEPS="/usr/lib/x86_64-linux-gnu/libzmq.a"
            # Add system ZeroMQ dependencies (will be dynamic, but documented)
            ZMQ_SYSTEM_DEPS="-Wl,-Bstatic ${ZMQ_DEPS} /usr/lib/x86_64-linux-gnu/libpgm.a -Wl,-Bdynamic -lgssapi_krb5 -lkrb5 -lk5crypto -lcom_err -lkrb5support -lnorm -lsodium"
        fi
        
        # Modify library variables to use -Wl,-Bstatic to force static linking of all libraries (except system libraries libc/libm)
        # Note: libc and libm usually remain dynamically linked for compatibility, but all other libraries are statically linked
        sed -i "s|BOOST_LIBS = .*|BOOST_LIBS = -Wl,-Bstatic /usr/lib/x86_64-linux-gnu/libboost_system.a /usr/lib/x86_64-linux-gnu/libboost_filesystem.a /usr/lib/x86_64-linux-gnu/libboost_program_options.a /usr/lib/x86_64-linux-gnu/libboost_thread.a /usr/lib/x86_64-linux-gnu/libboost_chrono.a -Wl,-Bdynamic|g" src/Makefile
        sed -i "s|SSL_LIBS = .*|SSL_LIBS = -Wl,-Bstatic ${SSL_LIBS_VAL} -Wl,-Bdynamic|g" src/Makefile
        sed -i "s|CRYPTO_LIBS = .*|CRYPTO_LIBS = -Wl,-Bstatic ${CRYPTO_LIBS_VAL} -Wl,-Bdynamic|g" src/Makefile
        sed -i "s|MINIUPNPC_LIBS = .*|MINIUPNPC_LIBS = -Wl,-Bstatic /usr/lib/x86_64-linux-gnu/libminiupnpc.a -Wl,-Bdynamic|g" src/Makefile
        # Event libraries: Force static linking
        # Check if static libraries exist
        if [ -f "/usr/lib/x86_64-linux-gnu/libevent.a" ] && [ -f "/usr/lib/x86_64-linux-gnu/libevent_pthreads.a" ]; then
            sed -i "s|EVENT_LIBS = .*|EVENT_LIBS = -Wl,-Bstatic /usr/lib/x86_64-linux-gnu/libevent_pthreads.a /usr/lib/x86_64-linux-gnu/libevent.a -Wl,-Bdynamic|g" src/Makefile
            sed -i "s|EVENT_PTHREADS_LIBS = .*|EVENT_PTHREADS_LIBS = -Wl,-Bstatic /usr/lib/x86_64-linux-gnu/libevent_pthreads.a -Wl,-Bdynamic|g" src/Makefile
        else
            echo "WARNING: Event static libraries not found, will use dynamic libraries"
            echo "  Install: libevent-dev (Debian/Ubuntu) or libevent-devel (RHEL/CentOS)"
        fi
        # ZeroMQ: Force use of depends version (fully static, no GSSAPI/NORM)
        sed -i "s|ZMQ_LIBS = .*|ZMQ_LIBS = -Wl,-Bstatic ${ZMQ_DEPS} -Wl,-Bdynamic|g" src/Makefile
        # Add zstd and zlib libraries (required by libcrypto)
        if [ -f "/usr/lib/x86_64-linux-gnu/libzstd.a" ] && [ -f "/usr/lib/x86_64-linux-gnu/libz.a" ]; then
            sed -i "s|CRYPTO_LIBS = .*|CRYPTO_LIBS = -Wl,-Bstatic ${CRYPTO_LIBS_VAL} /usr/lib/x86_64-linux-gnu/libzstd.a /usr/lib/x86_64-linux-gnu/libz.a -Wl,-Bdynamic|g" src/Makefile
        elif [ -f "/usr/lib/x86_64-linux-gnu/libzstd.a" ]; then
            sed -i "s|CRYPTO_LIBS = .*|CRYPTO_LIBS = -Wl,-Bstatic ${CRYPTO_LIBS_VAL} /usr/lib/x86_64-linux-gnu/libzstd.a -Wl,-Bdynamic|g" src/Makefile
        elif [ -f "/usr/lib/x86_64-linux-gnu/libz.a" ]; then
            sed -i "s|CRYPTO_LIBS = .*|CRYPTO_LIBS = -Wl,-Bstatic ${CRYPTO_LIBS_VAL} /usr/lib/x86_64-linux-gnu/libz.a -Wl,-Bdynamic|g" src/Makefile
        fi
        # Modify LDFLAGS - Force static linking of all libraries (except libc/libm, which are system libraries)
        # Use -static-libgcc -static-libstdc++ to statically link GCC runtime
        # Use -Wl,-Bstatic to force static linking of all specified libraries
        sed -i "s|^LDFLAGS = .*|LDFLAGS = -static-libgcc -static-libstdc++ -no-pie -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${PHICOINROOT}/db4/lib|g" src/Makefile
        # Modify executable LDFLAGS - Ensure all libraries are statically linked
        # Use -Wl,--as-needed to remove unused libraries
        # Use -Wl,-Bstatic to force static linking of all specified libraries
        sed -i "s|phicoind_LDFLAGS = .*|phicoind_LDFLAGS = -static-libgcc -static-libstdc++ -no-pie -Wl,--as-needed -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${PHICOINROOT}/db4/lib|g" src/Makefile
        sed -i "s|phicoin_cli_LDFLAGS = .*|phicoin_cli_LDFLAGS = -static-libgcc -static-libstdc++ -no-pie -Wl,--as-needed -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${PHICOINROOT}/db4/lib|g" src/Makefile
        sed -i "s|phicoin_tx_LDFLAGS = .*|phicoin_tx_LDFLAGS = -static-libgcc -static-libstdc++ -no-pie -Wl,--as-needed -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${PHICOINROOT}/db4/lib|g" src/Makefile
        
        # Qt executable LDFLAGS (if exists)
        if grep -q "phicoin_qt_LDFLAGS" src/Makefile; then
            sed -i "s|phicoin_qt_LDFLAGS = .*|phicoin_qt_LDFLAGS = -static-libgcc -static-libstdc++ -no-pie -Wl,--as-needed -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${PHICOINROOT}/db4/lib|g" src/Makefile
        fi
        
        # Ensure BDB library also uses static linking
        if grep -q "BDB_LIBS" src/Makefile; then
            sed -i "s|BDB_LIBS = .*|BDB_LIBS = -Wl,-Bstatic -L${PHICOINROOT}/db4/lib -ldb_cxx-4.8 -Wl,-Bdynamic|g" src/Makefile || \
            sed -i "s|BDB_LIBS = .*|BDB_LIBS = -Wl,-Bstatic ${PHICOINROOT}/db4/lib/libdb_cxx-4.8.a -Wl,-Bdynamic|g" src/Makefile
        fi
        
        # Qt5: Try static linking (if static libraries are available)
        # Note: Qt5 static build is complex, usually requires depends Qt5
        # If depends Qt5 is not available, we will try to use system Qt5 and force static linking
        if [ -f "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libQt5Core.a" ]; then
            echo "Using depends Qt5 (static)"
            QT5_LIB_DIR="${PHICOINROOT}/depends/x86_64-linux-gnu/lib"
            sed -i "s|QT_LIBS = .*|QT_LIBS = -Wl,-Bstatic -L${QT5_LIB_DIR} -lQt5Widgets -lQt5Gui -lQt5Network -lQt5Core -Wl,-Bdynamic|g" src/Makefile
        else
            echo "WARNING: depends Qt5 not found, Qt5 will remain dynamic"
            echo "  For fully static Qt5, build Qt5 in depends first:"
            echo "    cd depends && make HOST=x86_64-linux-gnu qt"
            echo "  Note: Qt5 static build requires xcb dependencies"
        fi
        
        # Qt executable LDFLAGS - Ensure static linking of other libraries
        if grep -q "phicoin_qt_LDFLAGS" src/Makefile; then
            sed -i "s|phicoin_qt_LDFLAGS = .*|phicoin_qt_LDFLAGS = -static-libgcc -static-libstdc++ -no-pie -Wl,--as-needed -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${PHICOINROOT}/db4/lib|g" src/Makefile
        fi
    fi
elif [[ ${OS} == "windows" ]]; then
    # Windows build: Ensure static linking of C++ standard library
    export LDFLAGS="-static-libgcc -static-libstdc++"
    if [ -f src/Makefile ]; then
        # Modify LDFLAGS for Windows
        sed -i "s|^LDFLAGS = .*|LDFLAGS = -static-libgcc -static-libstdc++|g" src/Makefile
        # Modify executable LDFLAGS - Ensure C++ standard library is statically linked
        sed -i "s|phicoind_LDFLAGS = .*|phicoind_LDFLAGS = -static-libgcc -static-libstdc++|g" src/Makefile
        sed -i "s|phicoin_cli_LDFLAGS = .*|phicoin_cli_LDFLAGS = -static-libgcc -static-libstdc++|g" src/Makefile
        sed -i "s|phicoin_tx_LDFLAGS = .*|phicoin_tx_LDFLAGS = -static-libgcc -static-libstdc++|g" src/Makefile
        # Qt executable LDFLAGS (if exists)
        if grep -q "phicoin_qt_LDFLAGS" src/Makefile; then
            sed -i "s|phicoin_qt_LDFLAGS = .*|phicoin_qt_LDFLAGS = -static-libgcc -static-libstdc++|g" src/Makefile
        fi
    fi
fi

make -sj16

case "$OS" in
    "linux")
        mkdir -p $PHICOINROOT/release/linux
        mv ./src/phicoin-cli ./release/linux 2>/dev/null || true
        mv ./src/phicoind ./release/linux 2>/dev/null || true
        mv ./src/qt/phicoin-qt ./release/linux 2>/dev/null || true
        # Statically linked executables can be safely stripped
        strip ./release/linux/* 2>/dev/null || true
        # Bundle Qt5 libraries for portability
        if [ -f "${PHICOINROOT}/release/linux/phicoin-qt" ]; then
            echo ""
            echo "Bundling Qt5 libraries for phicoin-qt..."
            bash ${PHICOINROOT}/phi_scripts/bundle_qt5.sh
        fi
        ;;
    "windows")
        mkdir -p $PHICOINROOT/release/win
        mv $PHICOINROOT/src/*.exe $PHICOINROOT/release/win
        mv $PHICOINROOT/src/qt/*.exe $PHICOINROOT/release/win
        # strip --strip-unneeded $PHICOINROOT/release/win/*
        ;;
    "arm")
        mkdir -p $PHICOINROOT/release/arm
        mv ./src/phicoin-cli ./release/arm 2>/dev/null || true
        mv ./src/phicoind ./release/arm 2>/dev/null || true
        mv ./src/qt/phicoin-qt ./release/arm 2>/dev/null || true
        # Statically linked executables can be safely stripped
        strip ./release/arm/* 2>/dev/null || true
        ;;
    "osx")
        mkdir -p $PHICOINROOT/release/osx
        mv ./src/phicoin-cli ./release/osx
        mv ./src/phicoind ./release/osx
        mv ./src/qt/phicoin-qt ./release/osx
        # strip ./release/osx/*
        ;;
    *)
        echo "Unsupported OS type: $OS"
        echo "Supported OS types: linux, windows, arm, osx"
        exit 1
        ;;
esac

echo "Build and strip completed for $OS"
