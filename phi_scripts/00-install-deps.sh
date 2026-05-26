#!/usr/bin/env bash

OS=${1}

if [[ ! ${OS} ]]; then
    echo "Error: Invalid options"
    echo "Usage: ${0} <operating system>"
    exit 1
fi

# Detect Debian/Ubuntu version
detect_distro() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        DISTRO_ID=${ID}
        DISTRO_VERSION=${VERSION_ID}
        DISTRO_CODENAME=${VERSION_CODENAME}
        
        # For Debian, extract version number
        if [[ ${ID} == "debian" ]]; then
            if [[ -f /etc/debian_version ]]; then
                DEBIAN_VERSION=$(cat /etc/debian_version | cut -d'.' -f1)
            fi
        fi
    fi
}

detect_distro

echo "----------------------------------------"
echo "Installing Build Packages for ${OS}"
if [[ -n ${DISTRO_ID} ]]; then
    echo "Detected: ${DISTRO_ID} ${DISTRO_VERSION:-${DEBIAN_VERSION}}"
fi
echo "----------------------------------------"

apt-get update

if [[ ${OS} == "windows" ]]; then
    apt-get install -y \
    automake \
    autotools-dev \
    bsdmainutils \
    build-essential \
    curl \
    mingw-w64 \
    mingw-w64-x86-64-dev \
    git \
    libcurl4-openssl-dev \
    libssl-dev \
    libtool \
    osslsigncode \
    nsis \
    pkg-config \
    python3 \
    rename \
    zip \
    bison

    update-alternatives --set x86_64-w64-mingw32-g++ /usr/bin/x86_64-w64-mingw32-g++-posix 


elif [[ ${OS} == "osx" ]]; then
    # Base packages
    OSX_BASE_PACKAGES="autoconf \
    automake \
    awscli \
    bsdmainutils \
    ca-certificates \
    cmake \
    curl \
    fonts-tuffy \
    g++ \
    git \
    imagemagick \
    libbz2-dev \
    libcap-dev \
    librsvg2-bin \
    libtiff-tools \
    libtool \
    libz-dev \
    p7zip-full \
    pkg-config \
    python3 \
    python3-dev \
    python3-setuptools \
    s3curl \
    sleuthkit \
    bison \
    python3-pip"
    
    # libtinfo5 -> libtinfo6 or libncurses-dev for Debian 13+
    if [[ ${DISTRO_ID} == "debian" && ${DEBIAN_VERSION} -ge 13 ]]; then
        OSX_PACKAGES="${OSX_BASE_PACKAGES} libncurses-dev"
    else
        OSX_PACKAGES="${OSX_BASE_PACKAGES} libtinfo5"
    fi
    
    apt -y install ${OSX_PACKAGES}

    pip3 install ds-store
    
elif [[ ${OS} == "linux" || ${OS} == "linux-disable-wallet" ]]; then
    # Local x86_64 Linux build - needs multilib for 32/64-bit support
    BASE_PACKAGES="apt-file \
    autoconf \
    automake \
    autotools-dev \
    binutils \
    bsdmainutils \
    build-essential \
    ca-certificates \
    curl \
    git \
    gnupg \
    libtool \
    nsis \
    pbuilder \
    pkg-config \
    python3 \
    rename \
    xkb-data \
    zip \
    bison"
    
    # Debian 13 (trixie) specific adjustments
    if [[ ${DISTRO_ID} == "debian" && ${DEBIAN_VERSION} -ge 13 ]]; then
        echo "Detected Debian 13+, using default GCC toolchain for local build"
        # Use default gcc/g++ with multilib support
        PACKAGES="${BASE_PACKAGES} \
        gcc-multilib \
        g++-multilib"
        
        # ubuntu-dev-tools is Ubuntu-specific, skip on Debian
    else
        # For older Debian/Ubuntu versions, try to install gcc-9 if available
        PACKAGES="${BASE_PACKAGES} \
        g++-9-multilib \
        gcc-9-multilib"
        
        # ubuntu-dev-tools only for Ubuntu
        if [[ ${DISTRO_ID} == "ubuntu" ]]; then
            PACKAGES="${PACKAGES} ubuntu-dev-tools"
        fi
    fi
    
    apt -y install ${PACKAGES}

elif [[ ${OS} == "aarch64" || ${OS} == "aarch64-disable-wallet" ]]; then
    # Cross-compilation to aarch64 - needs cross-compilation toolchain, NOT multilib
    BASE_PACKAGES="apt-file \
    autoconf \
    automake \
    autotools-dev \
    binutils-aarch64-linux-gnu \
    binutils \
    bsdmainutils \
    build-essential \
    ca-certificates \
    curl \
    g++-aarch64-linux-gnu \
    git \
    gnupg \
    libtool \
    nsis \
    pbuilder \
    pkg-config \
    python3 \
    rename \
    xkb-data \
    zip \
    bison"
    
    # Debian 13 (trixie) specific adjustments
    if [[ ${DISTRO_ID} == "debian" && ${DEBIAN_VERSION} -ge 13 ]]; then
        echo "Detected Debian 13+, using default GCC cross-compilation toolchain"
        # Use default cross-compilation gcc/g++ (NO multilib - conflicts with cross-compilation)
        PACKAGES="${BASE_PACKAGES} \
        gcc-aarch64-linux-gnu"
        
        # ubuntu-dev-tools is Ubuntu-specific, skip on Debian
    else
        # For older Debian/Ubuntu versions, try to install gcc-9 if available
        PACKAGES="${BASE_PACKAGES} \
        g++-9-aarch64-linux-gnu \
        gcc-9-aarch64-linux-gnu"
        
        # ubuntu-dev-tools only for Ubuntu
        if [[ ${DISTRO_ID} == "ubuntu" ]]; then
            PACKAGES="${PACKAGES} ubuntu-dev-tools"
        fi
    fi
    
    apt -y install ${PACKAGES}



elif [[ ${OS} == "arm32v7" || ${OS} == "arm32v7-disable-wallet" ]]; then
    # Base packages
    ARM_BASE_PACKAGES="autoconf \
    automake \
    binutils-aarch64-linux-gnu \
    binutils-arm-linux-gnueabihf \
    binutils \
    bsdmainutils \
    ca-certificates \
    curl \
    g++-aarch64-linux-gnu \
    g++-arm-linux-gnueabihf \
    git \
    libtool \
    pkg-config \
    python3 \
    bison"
    
    # Debian 13+ uses default GCC toolchain
    if [[ ${DISTRO_ID} == "debian" && ${DEBIAN_VERSION} -ge 13 ]]; then
        ARM_PACKAGES="${ARM_BASE_PACKAGES} \
        gcc-aarch64-linux-gnu \
        gcc-arm-linux-gnueabihf \
        gcc-multilib \
        g++-multilib"
    else
        # For older versions, try gcc-9
        ARM_PACKAGES="${ARM_BASE_PACKAGES} \
        g++-9-aarch64-linux-gnu \
        gcc-9-aarch64-linux-gnu \
        g++-9-arm-linux-gnueabihf \
        gcc-9-arm-linux-gnueabihf \
        g++-9-multilib \
        gcc-9-multilib"
    fi
    
    apt -y install ${ARM_PACKAGES}
else
    echo "you must pass the OS to build for"
    exit 1
fi

# Setup Python alternatives (skip python2 on Debian 13+)
if [[ ${DISTRO_ID} == "debian" && ${DEBIAN_VERSION} -ge 13 ]]; then
    # Debian 13+ doesn't have python2, use python3 as default
    if [[ -f /usr/bin/python3 && ! -f /usr/bin/python ]]; then
        update-alternatives --install /usr/bin/python python /usr/bin/python3 1 || \
        ln -sf /usr/bin/python3 /usr/bin/python
    fi
else
    # For older versions, setup python2/python3 alternatives
    if [[ -f /usr/bin/python2 ]]; then
        update-alternatives --install /usr/bin/python python /usr/bin/python2 1 2>/dev/null || true
    fi
    if [[ -f /usr/bin/python3 ]]; then
        update-alternatives --install /usr/bin/python python /usr/bin/python3 2 2>/dev/null || true
    fi
fi
