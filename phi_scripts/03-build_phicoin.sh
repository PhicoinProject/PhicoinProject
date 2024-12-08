#!/bin/bash

PHICOINROOT=$(pwd)
OS=$1

# find ./src -name '*.o' -type f -delete
# find ./src -name '*.a' -type f -delete
# find ./src -name '*.so' -type f -delete
# find ./src -name '*.dylib' -type f -delete

# make clean


make -sj16

case "$OS" in
    "linux")
        mkdir -p $PHICOINROOT/release/linux
        mv ./src/phicoin-cli ./release/linux
        mv ./src/phicoind ./release/linux
        mv ./src/qt/phicoin-qt ./release/linux
        # strip ./release/linux/*
        ;;
    "windows")
        mkdir -p $PHICOINROOT/release/win
        mv $PHICOINROOT/src/*.exe $PHICOINROOT/release/win
        mv $PHICOINROOT/src/qt/*.exe $PHICOINROOT/release/win
        # strip --strip-unneeded $PHICOINROOT/release/win/*
        ;;
    "arm")
        mkdir -p $PHICOINROOT/release/arm
        mv ./src/phicoin-cli ./release/arm
        mv ./src/phicoind ./release/arm
        mv ./src/qt/phicoin-qt ./release/arm
        # strip ./release/arm/*
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
