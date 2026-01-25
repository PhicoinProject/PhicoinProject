OS=${1}
PHICOINROOT=$(pwd)

# Berkeley DB installed using install_db4.sh (Ravencoin approach)
if [[ ${OS} == "linux" || ${OS} == "linux-disable-wallet" ]]; then
    export BDB_PREFIX=${PHICOINROOT}/db4
elif [[ ${OS} == "arm32v7" || ${OS} == "arm32v7-disable-wallet" ]]; then
    export BDB_PREFIX=${PHICOINROOT}/depends/arm-linux-gnueabihf
elif [[ ${OS} == "aarch64" || ${OS} == "aarch64-disable-wallet" ]]; then
    export BDB_PREFIX=${PHICOINROOT}/depends/aarch64-linux-gnu
else
    export BDB_PREFIX=/dev_phi/phi_source/db4/
fi

if [[ ! ${OS} || ! ${PHICOINROOT} ]]; then
    echo "Error: Invalid options"
    echo "Usage: ${0} <operating system> <github workspace path>"
    exit 1
fi

if [[ ${OS} == "windows" ]]; then
    export PATH=${PHICOINROOT}/depends/x86_64-w64-mingw32/native/bin:${PATH}
    # Set up Windows-specific flags for static linking
    export CFLAGS="-O2"
    export CXXFLAGS="-O2"
    # Static linking flags for Windows cross-compilation
    # -static-libgcc: Statically link GCC runtime
    # -static-libstdc++: Statically link C++ standard library
    export LDFLAGS="-static-libgcc -static-libstdc++"
elif [[ ${OS} == "osx" ]]; then
    export PATH=${PHICOINROOT}/depends/x86_64-apple-darwin14/native/bin:${PATH}
elif [[ ${OS} == "linux" || ${OS} == "linux-disable-wallet" ]]; then
    export PATH=${PHICOINROOT}/depends/x86_64-linux-gnu/native/bin:${PATH}
elif [[ ${OS} == "arm32v7" || ${OS} == "arm32v7-disable-wallet" ]]; then
    export PATH=${PHICOINROOT}/depends/arm-linux-gnueabihf/native/bin:${PATH}
elif [[ ${OS} == "aarch64" || ${OS} == "aarch64-disable-wallet" ]]; then
    export PATH=${PHICOINROOT}/depends/aarch64-linux-gnu/native/bin:${PATH}
else
    echo "You must pass an OS."
    echo "Usage: ${0} <operating system> <github workspace path>"
    exit 1
fi


if [[ ${OS} == "windows" ]]; then
    CONFIG_SITE=${PHICOINROOT}/depends/x86_64-w64-mingw32/share/config.site ./configure --prefix=/ --disable-ccache --disable-maintainer-mode --disable-dependency-tracking --enable-reduce-exports --disable-bench --disable-tests --disable-gui-tests --with-qtdbus=no --enable-shared=no --with-incompatible-bdb CFLAGS="-O2" CXXFLAGS="-O2" LDFLAGS="-static-libgcc -static-libstdc++"
elif [[ ${OS} == "osx" ]]; then
    CONFIG_SITE=${PHICOINROOT}/depends/x86_64-apple-darwin14/share/config.site ./configure --prefix=/ --disable-ccache --disable-maintainer-mode --disable-dependency-tracking --enable-reduce-exports --disable-bench --disable-tests --with-qtdbus=no --disable-gui-tests GENISOIMAGE=${PHICOINROOT}/depends/x86_64-apple-darwin14/native/bin/genisoimage
elif [[ ${OS} == "linux" || ${OS} == "linux-disable-wallet" ]]; then
    if [[ ${OS} == "linux-disable-wallet" ]]; then
        EXTRA_OPTS="--disable-wallet"
    fi
    # Berkeley DB installed using install_db4.sh (Ravencoin approach)
    # Ensure boost static libraries are in correct location and create symlinks
    echo "Ensuring boost static libraries are available..."
    BOOST_STAGE=$(find ${PHICOINROOT}/depends/work/build/x86_64-linux-gnu/boost -type d -path "*/stage/lib" 2>/dev/null | head -1)
    if [ -n "$BOOST_STAGE" ] && [ -d "$BOOST_STAGE" ]; then
        mkdir -p ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
        cp -f "$BOOST_STAGE"/*.a ${PHICOINROOT}/depends/x86_64-linux-gnu/lib/ 2>/dev/null
        cd ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
        for f in libboost_*-mt-s-x64.a; do
            if [ -f "$f" ]; then
                base=$(echo "$f" | sed 's/-mt-s-x64\.a$//')
                ln -sf "$f" "${base}.a" 2>/dev/null || true
            fi
        done
        echo "Boost static libraries copied from build directory"
    else
        # If build directory has been cleaned, try to copy from staging directory
        BOOST_STAGING=$(find ${PHICOINROOT}/depends/work/staging/x86_64-linux-gnu/boost -type d -name "lib" 2>/dev/null | head -1)
        if [ -n "$BOOST_STAGING" ] && [ -d "$BOOST_STAGING" ]; then
            mkdir -p ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
            cp -f "$BOOST_STAGING"/*.a ${PHICOINROOT}/depends/x86_64-linux-gnu/lib/ 2>/dev/null
            cd ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
            for f in libboost_*-mt-s-x64.a; do
                if [ -f "$f" ]; then
                    base=$(echo "$f" | sed 's/-mt-s-x64\.a$//')
                    ln -sf "$f" "${base}.a" 2>/dev/null || true
                fi
            done
            echo "Boost static libraries copied from staging directory"
        fi
    fi
    # Verify boost libraries exist
    if [ ! -f "${PHICOINROOT}/depends/x86_64-linux-gnu/lib/libboost_system.a" ]; then
        echo "WARNING: Boost static libraries not found! Attempting to rebuild boost..."
        cd ${PHICOINROOT}/depends && rm -rf built/x86_64-linux-gnu/boost work/staging/x86_64-linux-gnu/boost work/build/x86_64-linux-gnu/boost && make HOST=x86_64-linux-gnu boost 2>&1 | tail -5
        sleep 2
        BOOST_STAGE=$(find ${PHICOINROOT}/depends/work/build/x86_64-linux-gnu/boost -type d -path "*/stage/lib" 2>/dev/null | head -1)
        if [ -n "$BOOST_STAGE" ] && [ -d "$BOOST_STAGE" ]; then
            mkdir -p ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
            cp -f "$BOOST_STAGE"/*.a ${PHICOINROOT}/depends/x86_64-linux-gnu/lib/ 2>/dev/null
            cd ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
            for f in libboost_*-mt-s-x64.a; do
                if [ -f "$f" ]; then
                    base=$(echo "$f" | sed 's/-mt-s-x64\.a$//')
                    ln -sf "$f" "${base}.a" 2>/dev/null || true
                fi
            done
        fi
    fi
    # Use system boost 1.83 static libraries (code requires boost 1.83 API)
    # Copy system boost static libraries to depends directory for static linking
    mkdir -p ${PHICOINROOT}/depends/x86_64-linux-gnu/lib
    for lib in filesystem system program_options thread chrono; do
        if [ -f "/usr/lib/x86_64-linux-gnu/libboost_${lib}.a" ]; then
            cp -f /usr/lib/x86_64-linux-gnu/libboost_${lib}.a ${PHICOINROOT}/depends/x86_64-linux-gnu/lib/ 2>/dev/null || true
        fi
    done
    # Force static linking of all libraries
    export BOOST_ROOT=/usr
    export BOOST_LDFLAGS="-L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib"
    export BOOST_CPPFLAGS="-I/usr/include"
    export PKG_CONFIG_PATH=${PHICOINROOT}/depends/x86_64-linux-gnu/lib/pkgconfig:${PKG_CONFIG_PATH}
    export LD_LIBRARY_PATH=${PHICOINROOT}/depends/x86_64-linux-gnu/lib:${BDB_PREFIX}/lib
    export CPPFLAGS="-I/usr/include -I${PHICOINROOT}/depends/x86_64-linux-gnu/include"
    # Debug-friendly flags for dev builds (keep frame pointers + symbols)
    export CXXFLAGS="-O0 -g -fno-omit-frame-pointer -fno-pie"
    export CFLAGS="-O0 -g -fno-omit-frame-pointer -fno-pie"
    # Fully static compilation flags
    # -static-libgcc: Statically link GCC runtime
    # -static-libstdc++: Statically link C++ standard library
    # -no-pie: Disable position-independent executables
    # -Wl,-Bstatic: Force static linking of subsequent libraries
    # Note: libc and libm remain dynamically linked to ensure system compatibility
    export LDFLAGS="-static-libgcc -static-libstdc++ -no-pie -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${BDB_PREFIX}/lib"
    export LIBS="-L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${BDB_PREFIX}/lib"
    # Use system boost, but force static linking
    # Note: Fully static compilation means all libraries are statically linked except system libraries libc and libm
    # libc and libm remain dynamically linked to ensure compatibility with different Linux distributions
    cd ${PHICOINROOT} && CONFIG_SITE=${PHICOINROOT}/depends/x86_64-linux-gnu/share/config.site ./configure --prefix=/ --disable-ccache --disable-maintainer-mode --disable-dependency-tracking --enable-glibc-back-compat --enable-reduce-exports --disable-tests --with-qtdbus=no --disable-bench --with-qtdbus=no --disable-gui-tests --with-incompatible-bdb BOOST_LDFLAGS="-L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -Wl,-Bstatic" BOOST_CPPFLAGS="-I/usr/include" BDB_LIBS="-L${BDB_PREFIX}/lib -ldb_cxx-4.8" BDB_CFLAGS="-I${BDB_PREFIX}/include" CFLAGS="-O0 -g -fno-omit-frame-pointer -fno-pie" CXXFLAGS="-O0 -g -fno-omit-frame-pointer -fno-pie" LDFLAGS="-static-libgcc -static-libstdc++ -no-pie -L/usr/lib/x86_64-linux-gnu -L${PHICOINROOT}/depends/x86_64-linux-gnu/lib -L${BDB_PREFIX}/lib" ${EXTRA_OPTS}
elif [[ ${OS} == "arm32v7" || ${OS} == "arm32v7-disable-wallet" ]]; then
    if [[ ${OS} == "arm32v7-disable-wallet" ]]; then
        EXTRA_OPTS="--disable-wallet"
        CONFIG_SITE=${PHICOINROOT}/depends/arm-linux-gnueabihf/share/config.site ./configure --prefix=/ --enable-glibc-back-compat --enable-reduce-exports LDFLAGS="-static-libgcc -static-libstdc++ -static" --disable-tests --with-libs=no --with-gui=no ${EXTRA_OPTS}
    else
        CONFIG_SITE=${PHICOINROOT}/depends/arm-linux-gnueabihf/share/config.site ./configure --prefix=/ --disable-ccache --disable-maintainer-mode --disable-dependency-tracking --enable-glibc-back-compat --enable-reduce-exports --disable-bench --with-qtdbus=no --disable-gui-tests CFLAGS="-O2" CXXFLAGS="-O2" LDFLAGS="-static-libgcc -static-libstdc++ -static"
    fi
elif [[ ${OS} == "aarch64" || ${OS} == "aarch64-disable-wallet" ]]; then
    if [[ ${OS} == "aarch64-disable-wallet" ]]; then
        EXTRA_OPTS="--disable-wallet"
        CONFIG_SITE=${PHICOINROOT}/depends/aarch64-linux-gnu/share/config.site ./configure --prefix=/ --enable-glibc-back-compat --enable-reduce-exports LDFLAGS="-static-libgcc -static-libstdc++ -static" --disable-tests --with-libs=no --with-gui=no ${EXTRA_OPTS}
    else
        CONFIG_SITE=${PHICOINROOT}/depends/aarch64-linux-gnu/share/config.site ./configure --prefix=/ --disable-ccache --disable-maintainer-mode --disable-dependency-tracking --enable-glibc-back-compat --enable-reduce-exports --disable-bench --with-qtdbus=no --disable-gui-tests CFLAGS="-O2" CXXFLAGS="-O2" LDFLAGS="-static-libgcc -static-libstdc++ -static"
    fi
else
    echo "You must pass an OS."
    echo "Usage: ${0} <operating system> <github workspace path> <disable wallet (true | false)>"
    exit 1
fi

#  CONFIG_SITE=${PHICOINROOT}/depends/x86_64-linux-gnu/share/config.site ./configure --prefix=/ --disable-ccache --disable-maintainer-mode --disable-dependency-tracking --enable-glibc-back-compat --enable-reduce-exports --disable-bench --disable-gui-tests --disable-tests  CFLAGS="-O2 " CXXFLAGS="-O2 " LDFLAGS="-static-libstdc++"