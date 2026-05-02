FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies + ZeroMQ for notifications
RUN apt-get update && apt-get install -y \
    autoconf automake autotools-dev binutils bsdmainutils build-essential \
    ca-certificates curl git gnupg zip p7zip-full \
    libboost-all-dev libdb-dev libevent-dev libminiupnpc-dev \
    libprotobuf-dev libssl-dev libtool libqrencode-dev \
    pkg-config protobuf-compiler python3 qttools5-dev qttools5-dev-tools \
    libczmq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /phicoin
COPY . .

# Build Berkeley DB 4.8
RUN chmod +x autogen.sh phi_scripts/*.sh contrib/install_db4.sh share/genbuild.sh && \
    ./autogen.sh && \
    bash contrib/install_db4.sh . && \
    BDB_LIBS="-L../db4/lib -ldb_cxx-4.8" BDB_CFLAGS="-I../db4/include" \
        ./configure --with-incompatible-bdb --disable-tests --disable-bench \
        && make -j$(nproc)

# Package release artifacts
RUN mkdir -p /release && \
    cp src/phicoind /release/ && \
    cp src/phicoin-cli /release/

# Extract runtime shared libraries needed by phicoind and phicoin-cli
RUN mkdir -p /deps && \
    for bin in /release/phicoind /release/phicoin-cli; do \
      ldd "$bin" 2>/dev/null | grep -oP '/\S+\.so\S*' | while read lib; do \
        [ -f "$lib" ] && cp -n "$lib" /deps/ 2>/dev/null; \
      done; \
    done

# Runtime image
FROM ubuntu:22.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates \
    && rm -rf /var/lib/apt/lists/* && \
    useradd -ms /bin/bash phicoin

# Copy the binaries
COPY --from=builder /release/phicoind /usr/local/bin/phicoind
COPY --from=builder /release/phicoin-cli /usr/local/bin/phicoin-cli

# Copy runtime shared libraries extracted from builder
COPY --from=builder /deps/*.so* /usr/lib/x86_64-linux-gnu/

RUN ldconfig

RUN mkdir -p /var/lib/phicoin && chown -R phicoin:phicoin /var/lib/phicoin
VOLUME ["/var/lib/phicoin"]
EXPOSE 28964 28966

USER phicoin
WORKDIR /var/lib/phicoin
CMD ["phicoind", "-printtoconsole", "-daemon=0", "-datadir=/var/lib/phicoin"]
