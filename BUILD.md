# Building Phicoin from Source

## Linux Build

### Quick Build (All-in-One Command)

```bash
git clone https://github.com/PhicoinProject/PhicoinProject phicoin && cd phicoin && bash phi_scripts/01-config.sh linux && bash phi_scripts/02-export-path.sh linux && bash phi_scripts/03-build_phicoin.sh linux && echo "✓ Build complete! Executables: $(pwd)/release/linux/"
```

### Prerequisites

- Linux (Debian/Ubuntu recommended)
- Build tools: `gcc`, `g++`, `make`, `autoconf`, `automake`, `libtool`, `pkg-config`
- Development libraries: `libboost-dev`, `libssl-dev`, `libevent-dev`, `libminiupnpc-dev`, `libqt5-dev`, `qttools5-dev`, `qttools5-dev-tools`, `libdb-dev`, `libqrencode-dev`, `protobuf-compiler`, `libprotobuf-dev`

### Step-by-Step Build

#### 1. Clone Repository
```bash
git clone https://github.com/PhicoinProject/PhicoinProject phicoin
cd phicoin
```

#### 2. Configure Build System
```bash
bash phi_scripts/01-config.sh linux
```

#### 3. Export Environment Variables
```bash
bash phi_scripts/02-export-path.sh linux
```

#### 4. Build Executables
```bash
bash phi_scripts/03-build_phicoin.sh linux
```

#### 5. Verify Build
```bash
ls -lh release/linux/
```

### Build Output

Executables are located in: `release/linux/`

- `phicoind` - Daemon (fully static, portable)
- `phicoin-cli` - CLI tool (fully static, portable)
- `phicoin-qt` - GUI wallet (requires Qt5 libraries)
- `phicoin-qt-portable.sh` - Launcher script
- `qt5_libs/` - Bundled Qt5 libraries

### Running Executables

```bash
cd release/linux
./phicoind                    # Start daemon
./phicoin-cli --version       # CLI tool
./phicoin-qt-portable.sh      # GUI wallet
```

### Optional: Create Distribution Package

```bash
bash phi_scripts/04-release.sh
```

Creates: `release/phicoin_<version>_linux.zip` and `release/checksums.md`

---

## Windows Build

### Quick Build (All-in-One Command)

```bash
git clone https://github.com/PhicoinProject/PhicoinProject phicoin && cd phicoin && bash phi_scripts/00-install-deps.sh windows && bash phi_scripts/01-config.sh windows && bash phi_scripts/02-export-path.sh windows && bash phi_scripts/03-build_phicoin.sh windows && echo "✓ Build complete! Executables: $(pwd)/release/win/"
```

### Prerequisites

- Linux (Debian/Ubuntu recommended) for cross-compilation
- Build tools: `gcc`, `g++`, `make`, `autoconf`, `automake`, `libtool`, `pkg-config`
- Cross-compilation tools: `mingw-w64`, `mingw-w64-x86-64-dev`
- Additional tools: `osslsigncode`, `nsis` (for code signing and installer creation)

### Step-by-Step Build

#### 1. Clone Repository
```bash
git clone https://github.com/PhicoinProject/PhicoinProject phicoin
cd phicoin
```

#### 2. Install Dependencies
```bash
bash phi_scripts/00-install-deps.sh windows
```

#### 3. Configure Build System
```bash
bash phi_scripts/01-config.sh windows
```

#### 4. Export Environment Variables
```bash
bash phi_scripts/02-export-path.sh windows
```

#### 5. Build Executables
```bash
bash phi_scripts/03-build_phicoin.sh windows
```

#### 6. Verify Build
```bash
ls -lh release/win/
```

### Build Output

Executables are located in: `release/win/`

- `phicoind.exe` - Daemon
- `phicoin-cli.exe` - CLI tool
- `phicoin-qt.exe` - GUI wallet

### Running Executables

Windows executables can be run directly on Windows systems. Copy the files from `release/win/` to your Windows machine and run them.

### Optional: Create Distribution Package

```bash
bash phi_scripts/04-release.sh
```

Creates: `release/phicoin_<version>_windows.zip` and `release/checksums.md`
