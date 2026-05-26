#!/bin/bash

if [ -z "$1" ]; then
    echo "Usage: $0 <operating system type>"
    exit 1
fi

OS_TYPE=$1


./xbuild_scripts/00-install-deps.sh "$OS_TYPE"
if [ $? -ne 0 ]; then
    echo "00-install-deps.sh failed"
    exit 1
fi

./xbuild_scripts/01-config.sh "$OS_TYPE"
if [ $? -ne 0 ]; then
    echo "01-config.sh failed"
    exit 1
fi

./xbuild_scripts/02-export-path.sh "$OS_TYPE"
if [ $? -ne 0 ]; then
    echo "02-export-path.sh failed"
    exit 1
fi

./xbuild_scripts/03-build_phicoin.sh "$OS_TYPE"
if [ $? -ne 0 ]; then
    echo "03-build_phicoin.sh failed"
    exit 1
fi

echo "All scripts executed successfully"
