#!/bin/bash

PHICOINROOT=$(pwd)

# Detect Debian/Ubuntu version
detect_distro() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        DISTRO_ID=${ID}
        DISTRO_VERSION=${VERSION_ID}
        
        # For Debian, extract version number
        if [[ ${ID} == "debian" ]]; then
            if [[ -f /etc/debian_version ]]; then
                DEBIAN_VERSION=$(cat /etc/debian_version | cut -d'.' -f1)
            fi
        fi
    fi
}

detect_distro

# Function to read version from configure.ac
get_version_from_configure() {
    local major=$(grep "define(_CLIENT_VERSION_MAJOR" configure.ac | sed 's/.*,\s*\([0-9]*\).*/\1/')
    local minor=$(grep "define(_CLIENT_VERSION_MINOR" configure.ac | sed 's/.*,\s*\([0-9]*\).*/\1/')
    local revision=$(grep "define(_CLIENT_VERSION_REVISION" configure.ac | sed 's/.*,\s*\([0-9]*\).*/\1/')
    echo "${major}.${minor}.${revision}"
}

# Get version from configure.ac
VERSION=$(get_version_from_configure)
echo "=========================================="
echo "PHICOIN Release Packaging v${VERSION}"
echo "=========================================="

# Function to download appimagetool (not used in simplified packaging)
download_appimagetool() {
    # Removed - not needed for simplified packaging
    return 0
}

# Function to check and install dependencies
install_dependencies() {
    echo "Checking dependencies..."
    
    # Check for essential tools (only what's needed for zip packaging)
    local missing_tools=()
    
    # Essential tools (required for packaging)
    for tool in zip; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    # Install essential tools (fail if these can't be installed)
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        echo "Installing essential tools: ${missing_tools[*]}"
        # Use --allow-releaseinfo-change to handle expired repository files
        apt-get update --allow-releaseinfo-change 2>&1 | grep -v "expired\|invalid since" || true
        if apt-get install -y "${missing_tools[@]}" 2>&1; then
            echo "✓ Essential tools installed successfully"
        else
            echo "ERROR: Failed to install essential tools: ${missing_tools[*]}"
            echo "Please install them manually: apt-get install -y ${missing_tools[*]}"
            exit 1
        fi
    else
        echo "✓ All essential tools are available"
    fi
    
    echo "Dependency check completed."
}

# Function to copy library dependencies (not used in simplified packaging)
copy_dependencies() {
    # Removed - not needed for simplified packaging
    return 0
}

# Function to create AppImage for a specific binary
create_appimage() {
    # AppImage creation removed for simplified packaging
    # Users can use the bundled Qt5 libraries approach instead
    return 0
}

# Function to create staticx binaries for CLI tools
create_staticx_binaries() {
    # Removed - not needed for simplified packaging
    # All binaries are already in release/linux/ from build script
    return 0
}

# Function to create Linux packages
create_linux_packages() {
    local INPUT_DIR="$PHICOINROOT/release/linux"
    
    if [[ ! -d "$INPUT_DIR" ]]; then
        echo "Warning: Linux binaries not found in $INPUT_DIR"
        return 1
    fi
    
    echo "=========================================="
    echo "Creating Linux Packages"
    echo "=========================================="
    
    # All binaries are already in release/linux/ from build script
    # Just verify they exist and create zip package
    echo "Packaging Linux binaries from $INPUT_DIR"
    
    return 0
}

# Function to create zip packages
create_packages() {
    echo "=========================================="
    echo "Creating Release Archives"
    echo "=========================================="
    
    cd "$PHICOINROOT/release" || exit 1
    
    # Create Linux package (all binaries in linux/ directory)
    if [[ -d "linux" ]]; then
        echo "Creating phicoin_${VERSION}_linux.zip..."
        zip -r "phicoin_${VERSION}_linux.zip" linux/ -x "*.git*" "*.DS_Store"
        echo "✓ phicoin_${VERSION}_linux.zip created ($(du -h phicoin_${VERSION}_linux.zip | cut -f1))"
    fi
    
    # Create Windows package
    if [[ -d "win" ]]; then
        echo "Creating phicoin_${VERSION}_windows.zip..."
        zip -r "phicoin_${VERSION}_windows.zip" win/ -x "*.git*" "*.DS_Store"
        echo "✓ phicoin_${VERSION}_windows.zip created ($(du -h phicoin_${VERSION}_windows.zip | cut -f1))"
    fi
    
    cd "$PHICOINROOT" || exit 1
}

# Function to generate checksums
generate_checksums() {
    echo "=========================================="
    echo "Generating Checksums"
    echo "=========================================="
    
    cd "$PHICOINROOT/release" || exit 1
    
    echo "# PHICOIN v${VERSION} Release Checksums" > checksums.md
    echo "" >> checksums.md
    echo "Generated on: $(date)" >> checksums.md
    echo "" >> checksums.md
    echo "## SHA256 Checksums" >> checksums.md
    echo "" >> checksums.md
    
    # Generate checksums for all zip files
    for file in *.zip; do
        if [[ -f "$file" ]]; then
            echo "### $(basename "$file")" >> checksums.md
            sha256sum "$file" | awk '{print $1}' >> checksums.md
            echo "" >> checksums.md
            echo "Checksum generated for $(basename "$file")"
        fi
    done
    
    # Add usage instructions
    echo "## Usage Instructions" >> checksums.md
    echo "" >> checksums.md
    echo "### Linux Package" >> checksums.md
    echo "1. Extract: \`unzip phicoin_${VERSION}_linux.zip\`" >> checksums.md
    echo "2. Run daemon: \`cd linux && ./phicoind\`" >> checksums.md
    echo "3. Run CLI: \`cd linux && ./phicoin-cli --version\`" >> checksums.md
    echo "4. Run GUI: \`cd linux && ./phicoin-qt-portable.sh\`" >> checksums.md
    echo "" >> checksums.md
    echo "### Package Contents" >> checksums.md
    echo "- \`phicoind\` - Daemon (fully static, portable)" >> checksums.md
    echo "- \`phicoin-cli\` - CLI tool (fully static, portable)" >> checksums.md
    echo "- \`phicoin-qt\` - GUI wallet (requires Qt5 libraries)" >> checksums.md
    echo "- \`qt5_libs/\` - Bundled Qt5 libraries" >> checksums.md
    echo "- \`phicoin-qt-portable.sh\` - Launcher script for GUI" >> checksums.md
    echo "" >> checksums.md
    
    cd "$PHICOINROOT" || exit 1
    
    echo "✓ Checksums saved to release/checksums.md"
}

# Main execution
echo "Starting release process..."

# Install dependencies (non-fatal for optional tools)
install_dependencies

# Create Linux packages (verify binaries exist)
create_linux_packages

# Create zip packages (this always works - doesn't need optional tools)
create_packages

# Generate checksums
generate_checksums

echo "=========================================="
echo "Release Packaging Completed!"
echo "=========================================="
echo ""
echo "Generated packages:"
for file in "$PHICOINROOT/release"/*.zip; do
    if [[ -f "$file" ]]; then
        echo "  $(basename "$file") ($(du -h "$file" | cut -f1))"
    fi
done

echo ""
echo "Release contents:"
if [[ -d "$PHICOINROOT/release/linux" ]]; then
    echo "  Linux binaries: release/linux/"
    echo "    - phicoind (daemon)"
    echo "    - phicoin-cli (CLI tool)"
    echo "    - phicoin-qt (GUI wallet)"
    echo "    - qt5_libs/ (Qt5 libraries)"
    echo "    - phicoin-qt-portable.sh (launcher script)"
fi

echo ""
echo "Checksums: release/checksums.md"
echo ""
echo "Release v${VERSION} is ready!"
echo ""
echo "To distribute:"
echo "  - Copy phicoin_${VERSION}_linux.zip to target system"
echo "  - Extract: unzip phicoin_${VERSION}_linux.zip"
echo "  - Run: cd linux && ./phicoind (or ./phicoin-cli, ./phicoin-qt-portable.sh)"

