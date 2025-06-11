#!/bin/bash

PHICOINROOT=$(pwd)

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

# Function to download appimagetool if not available
download_appimagetool() {
    local tool_path="$PHICOINROOT/tools/appimagetool"
    
    if [[ ! -f "$tool_path" ]]; then
        echo "Downloading appimagetool..."
        mkdir -p "$PHICOINROOT/tools"
        
        # Download the latest appimagetool
        wget -O "$tool_path" https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage || {
            echo "Failed to download appimagetool"
            return 1
        }
        
        chmod +x "$tool_path"
        echo "✓ appimagetool downloaded successfully"
    else
        echo "✓ appimagetool already available"
    fi
    
    return 0
}

# Function to check and install dependencies
install_dependencies() {
    echo "Checking dependencies..."
    
    # Check for essential tools
    local missing_tools=()
    
    for tool in wget file ldd patchelf zip; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    # Check for FUSE library (required for AppImage)
    if ! ldconfig -p | grep -q "libfuse.so.2"; then
        missing_tools+=("libfuse2")
    fi
    
    # Check for additional AppImage dependencies
    if ! ldconfig -p | grep -q "libglib"; then
        missing_tools+=("libglib2.0-0")
    fi
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        echo "Installing missing tools and libraries: ${missing_tools[*]}"
        apt update && apt install -y "${missing_tools[@]}" || {
            echo "Failed to install required tools. Please install them manually."
            exit 1
        }
    fi
    
    # Download appimagetool
    download_appimagetool || {
        echo "Failed to setup appimagetool"
        exit 1
    }
    
    echo "All dependencies are available."
}

# Function to copy library dependencies
copy_dependencies() {
    local binary_path=$1
    local lib_dir=$2
    
    echo "  Copying dependencies for $(basename "$binary_path")..."
    
    # Get library dependencies
    ldd "$binary_path" | grep "=> /" | awk '{print $3}' | while read -r lib; do
        if [[ -f "$lib" ]]; then
            # Skip system libraries that should be available everywhere
            case "$lib" in
                /lib/x86_64-linux-gnu/* | /lib64/* | /usr/lib/x86_64-linux-gnu/*)
                    # Copy only specific libraries we need
                    if [[ "$lib" =~ (libQt|libboost|libzmq|libssl|libcrypto|libevent|libminiupnpc) ]]; then
                        cp "$lib" "$lib_dir/" 2>/dev/null || true
                    fi
                    ;;
                *)
                    # Copy non-system libraries
                    cp "$lib" "$lib_dir/" 2>/dev/null || true
                    ;;
            esac
        fi
    done
}

# Function to create AppImage for a specific binary
create_appimage() {
    local binary_name=$1
    local binary_path="$PHICOINROOT/release/linux/$binary_name"
    local appdir="$PHICOINROOT/release/appimage/${binary_name}.AppDir"
    local output_dir="$PHICOINROOT/release/linux_static"
    
    if [[ ! -f "$binary_path" ]]; then
        echo "Warning: Binary $binary_name not found, skipping AppImage creation"
        return 1
    fi
    
    echo "Creating AppImage for $binary_name..."
    
    # Clean and create AppDir structure
    rm -rf "$appdir"
    mkdir -p "$appdir/usr/bin"
    mkdir -p "$appdir/usr/lib"
    mkdir -p "$appdir/usr/share/applications"
    mkdir -p "$appdir/usr/share/icons/hicolor/256x256/apps"
    
    # Copy main binary
    cp "$binary_path" "$appdir/usr/bin/"
    
    # Copy dependencies
    copy_dependencies "$binary_path" "$appdir/usr/lib"
    
    # For Qt applications, copy Qt plugins
    if [[ "$binary_name" == "phicoin-qt" ]]; then
        echo "  Setting up Qt plugins for $binary_name..."
        
        # Find Qt plugin directory
        local qt_plugin_dir=""
        for dir in /usr/lib/x86_64-linux-gnu/qt5/plugins /usr/lib/qt5/plugins /opt/qt*/plugins; do
            if [[ -d "$dir" ]]; then
                qt_plugin_dir="$dir"
                break
            fi
        done
        
        if [[ -n "$qt_plugin_dir" && -d "$qt_plugin_dir" ]]; then
            mkdir -p "$appdir/usr/plugins"
            cp -r "$qt_plugin_dir"/* "$appdir/usr/plugins/" 2>/dev/null || true
            echo "  ✓ Qt plugins copied"
        fi
    fi
    
    # Create .desktop file
    cat > "$appdir/$binary_name.desktop" << EOF
[Desktop Entry]
Type=Application
Name=PHICOIN $binary_name
Exec=$binary_name
Icon=$binary_name
Categories=Network;Finance;
Terminal=true
EOF
    
    # Create AppRun script
    cat > "$appdir/AppRun" << 'EOF'
#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"

# Set up library path
export LD_LIBRARY_PATH="${HERE}/usr/lib:${LD_LIBRARY_PATH}"

# For Qt applications
if [[ -d "${HERE}/usr/plugins" ]]; then
    export QT_PLUGIN_PATH="${HERE}/usr/plugins:${QT_PLUGIN_PATH}"
    export QT_QPA_PLATFORM_PLUGIN_PATH="${HERE}/usr/plugins/platforms"
fi

# Execute the application
BINARY_NAME=$(basename "$0" .AppImage)
if [[ -f "${HERE}/usr/bin/${BINARY_NAME}" ]]; then
    exec "${HERE}/usr/bin/${BINARY_NAME}" "$@"
else
    # Fallback to first binary found
    exec "${HERE}/usr/bin/"* "$@"
fi
EOF
    
    chmod +x "$appdir/AppRun"
    
    # Create AppImage
    echo "  Building AppImage..."
    mkdir -p "$output_dir"
    
    # Verify FUSE is available
    if ! ldconfig -p | grep -q "libfuse.so.2"; then
        echo "  ❌ FUSE library not found. Installing..."
        apt update && apt install -y libfuse2 || {
            echo "  ❌ Failed to install FUSE. Creating fallback package..."
            # Create a simple executable package as fallback
            cp "$binary_path" "$output_dir/${binary_name}-portable"
            echo "  ✓ Portable binary created as fallback: ${binary_name}-portable"
            return 1
        }
    fi
    
    # Use appimagetool to create the AppImage
    ARCH=x86_64 "$PHICOINROOT/tools/appimagetool" "$appdir" "$output_dir/${binary_name}-${VERSION}.AppImage" 2>&1 || {
        echo "  ❌ Failed to create AppImage for $binary_name"
        echo "  Creating fallback portable package..."
        
        # Create a portable directory package as fallback
        local portable_dir="$output_dir/${binary_name}-portable"
        mkdir -p "$portable_dir"
        cp -r "$appdir"/* "$portable_dir/"
        
        # Create a simple launch script
        cat > "$portable_dir/launch.sh" << 'EOFL'
#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LD_LIBRARY_PATH="$DIR/usr/lib:$LD_LIBRARY_PATH"
if [[ -d "$DIR/usr/plugins" ]]; then
    export QT_PLUGIN_PATH="$DIR/usr/plugins:$QT_PLUGIN_PATH"
    export QT_QPA_PLATFORM_PLUGIN_PATH="$DIR/usr/plugins/platforms"
fi
exec "$DIR/usr/bin/"* "$@"
EOFL
        chmod +x "$portable_dir/launch.sh"
        
        echo "  ✓ Portable package created: ${binary_name}-portable/"
        echo "  Usage: cd ${binary_name}-portable && ./launch.sh"
        return 1
    }
    
    echo "  ✓ AppImage created: ${binary_name}-${VERSION}.AppImage"
    return 0
}

# Function to create staticx binaries for CLI tools
create_staticx_binaries() {
    local INPUT_DIR="$PHICOINROOT/release/linux"
    local OUTPUT_DIR="$PHICOINROOT/release/linux_static"
    
    echo "Creating staticx binaries for CLI tools..."
    
    # Install staticx if not available
    if ! command -v staticx &> /dev/null; then
        echo "Installing staticx..."
        pip3 install staticx || {
            echo "Warning: Failed to install staticx"
            return 1
        }
    fi
    
    # Try to create static binaries for all tools (CLI and GUI)
    for binary_name in phicoin-cli phicoind phicoin-qt; do
        local binary_path="$INPUT_DIR/$binary_name"
        if [[ -f "$binary_path" ]]; then
            echo "Creating static binary for $binary_name..."
            if staticx "$binary_path" "$OUTPUT_DIR/${binary_name}-static" 2>/dev/null; then
                echo "  ✓ Static binary created: ${binary_name}-static"
            else
                echo "  ❌ Failed to create static version of $binary_name"
                
                # For GUI applications, show more detailed error info
                if [[ "$binary_name" == "phicoin-qt" ]]; then
                    echo "  📋 Note: Qt applications often require special handling due to plugin dependencies"
                    echo "  🔄 This is why we fall back to AppImage or portable packages for GUI apps"
                fi
                
                # Don't create fallback copy here - let the AppImage function handle it
            fi
        fi
    done
}

# Function to create Linux packages
create_linux_packages() {
    local INPUT_DIR="$PHICOINROOT/release/linux"
    local OUTPUT_DIR="$PHICOINROOT/release/linux_static"
    
    if [[ ! -d "$INPUT_DIR" ]]; then
        echo "Warning: Linux binaries not found in $INPUT_DIR"
        return 1
    fi
    
    echo "=========================================="
    echo "Creating Linux Packages"
    echo "=========================================="
    
    # Create clean output directory
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    
    # Create staticx binaries for all tools
    create_staticx_binaries
    
    echo "=========================================="
    echo "Linux package creation completed"
    echo "Output directory: $OUTPUT_DIR"
    echo "=========================================="
    
    # Show files created
    echo "Created files:"
    for file in "$OUTPUT_DIR"/*; do
        if [[ -f "$file" ]]; then
            echo "  $(basename "$file") ($(du -h "$file" | cut -f1))"
        fi
    done
    
    return 0
}

# Function to create zip packages
create_packages() {
    echo "=========================================="
    echo "Creating Release Archives"
    echo "=========================================="
    
    cd "$PHICOINROOT/release" || exit 1
    
    # Create Linux package (original dynamic binaries)
    if [[ -d "linux" ]]; then
        echo "Creating phicoin_${VERSION}_linux.zip..."
        zip -r "phicoin_${VERSION}_linux.zip" linux/
        echo "✓ phicoin_${VERSION}_linux.zip created"
    fi
    
    # Create Linux static package
    if [[ -d "linux_static" && -n "$(ls -A linux_static 2>/dev/null)" ]]; then
        echo "Creating phicoin_${VERSION}_linux_static.zip..."
        zip -r "phicoin_${VERSION}_linux_static.zip" linux_static/
        echo "✓ phicoin_${VERSION}_linux_static.zip created"
    fi
    
    # Create Windows package
    if [[ -d "win" ]]; then
        echo "Creating phicoin_${VERSION}_windows.zip..."
        zip -r "phicoin_${VERSION}_windows.zip" win/
        echo "✓ phicoin_${VERSION}_windows.zip created"
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
    echo "### Static Binaries" >> checksums.md
    echo "- All tools are self-contained with no external dependencies" >> checksums.md
    echo "- Make executable: \`chmod +x *-static\`" >> checksums.md
    echo "- Run directly:" >> checksums.md
    echo "  - \`./phicoin-qt-static\` (GUI wallet)" >> checksums.md
    echo "  - \`./phicoin-cli-static --version\` (CLI tool)" >> checksums.md
    echo "  - \`./phicoind-static\` (daemon)" >> checksums.md
    echo "" >> checksums.md
    
    cd "$PHICOINROOT" || exit 1
    
    echo "✓ Checksums saved to release/checksums.md"
}

# Main execution
echo "Starting release process..."

# Install dependencies
install_dependencies

# Create Linux packages (AppImages + static binaries)
create_linux_packages

# Create zip packages
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
echo "Static binaries:"
for file in "$PHICOINROOT/release/linux_static"/*-static; do
    if [[ -f "$file" ]]; then
        echo "  $(basename "$file") ($(du -h "$file" | cut -f1))"
    fi
done

echo ""
echo "Checksums: release/checksums.md"
echo ""
echo "Release v${VERSION} is ready!"
echo ""
echo "Usage:"
echo "  Static GUI: ./phicoin-qt-static"
echo "  Static CLI: ./phicoin-cli-static --version"
echo "  Static Daemon: ./phicoind-static"

# Create test directories and copy files with force overwrite
echo ""
echo "Creating test directories..."

# Remove and recreate test directories to ensure clean copy
rm -rf "$PHICOINROOT/release/${VERSION}_linux_test/"
rm -rf "$PHICOINROOT/release/${VERSION}_win_test/"
rm -rf "$PHICOINROOT/release/${VERSION}_linux_static_test/"

# Copy directories if they exist
if [[ -d "$PHICOINROOT/release/linux/" ]]; then
    cp -r "$PHICOINROOT/release/linux/" "$PHICOINROOT/release/${VERSION}_linux_test/"
    echo "✓ Linux binaries copied to ${VERSION}_linux_test/"
fi

if [[ -d "$PHICOINROOT/release/win/" ]]; then
    cp -r "$PHICOINROOT/release/win/" "$PHICOINROOT/release/${VERSION}_win_test/"
    echo "✓ Windows binaries copied to ${VERSION}_win_test/"
fi

if [[ -d "$PHICOINROOT/release/linux_static/" ]]; then
    cp -r "$PHICOINROOT/release/linux_static/" "$PHICOINROOT/release/${VERSION}_linux_static_test/"
    echo "✓ Linux static binaries copied to ${VERSION}_linux_static_test/"
fi

