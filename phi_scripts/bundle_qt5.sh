#!/bin/bash
# Bundle Qt5 libraries with phicoin-qt for portability

PHICOINROOT=$(cd "$(dirname "$0")/.." && pwd)
RELEASE_DIR="${PHICOINROOT}/release/linux"
QT_BUNDLE_DIR="${RELEASE_DIR}/qt5_libs"

if [ ! -f "${RELEASE_DIR}/phicoin-qt" ]; then
    echo "ERROR: phicoin-qt not found in ${RELEASE_DIR}"
    exit 1
fi

echo "=== Bundling Qt5 libraries with phicoin-qt ==="

# Create Qt5 libraries directory
mkdir -p "${QT_BUNDLE_DIR}"

# Get Qt5 library paths
QT5_LIBS=$(ldd "${RELEASE_DIR}/phicoin-qt" 2>&1 | grep "Qt5" | awk '{print $3}' | sort -u)

if [ -z "$QT5_LIBS" ]; then
    echo "No Qt5 libraries found in phicoin-qt dependencies"
    exit 1
fi

echo "Found Qt5 libraries:"
echo "$QT5_LIBS" | sed 's/^/  /'

# Copy Qt5 libraries
echo ""
echo "Copying Qt5 libraries..."
for lib in $QT5_LIBS; do
    if [ -f "$lib" ]; then
        cp "$lib" "${QT_BUNDLE_DIR}/"
        echo "  ✅ Copied: $(basename $lib)"
    fi
done

# Copy Qt5 plugins (if needed)
QT5_PLUGIN_DIR=$(pkg-config --variable=plugindir Qt5Core 2>/dev/null)
if [ -n "$QT5_PLUGIN_DIR" ] && [ -d "$QT5_PLUGIN_DIR" ]; then
    echo ""
    echo "Copying Qt5 plugins..."
    mkdir -p "${QT_BUNDLE_DIR}/plugins"
    # Copy essential plugins
    for plugin_dir in platforms xcb; do
        if [ -d "${QT5_PLUGIN_DIR}/${plugin_dir}" ]; then
            cp -r "${QT5_PLUGIN_DIR}/${plugin_dir}" "${QT_BUNDLE_DIR}/plugins/"
            echo "  ✅ Copied plugins: $plugin_dir"
        fi
    done
fi

# Create launcher script
cat > "${RELEASE_DIR}/phicoin-qt-portable.sh" << 'EOF'
#!/bin/bash
# Portable launcher for phicoin-qt with bundled Qt5 libraries

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="${SCRIPT_DIR}/qt5_libs:${LD_LIBRARY_PATH}"
export QT_PLUGIN_PATH="${SCRIPT_DIR}/qt5_libs/plugins:${QT_PLUGIN_PATH}"

exec "${SCRIPT_DIR}/phicoin-qt" "$@"
EOF

chmod +x "${RELEASE_DIR}/phicoin-qt-portable.sh"

echo ""
echo "=========================================="
echo "Qt5 bundling complete!"
echo ""
echo "Files created:"
echo "  - ${QT_BUNDLE_DIR}/ (Qt5 libraries)"
echo "  - ${RELEASE_DIR}/phicoin-qt-portable.sh (launcher script)"
echo ""
echo "To run phicoin-qt on another system:"
echo "  1. Copy the entire release/linux/ directory"
echo "  2. Run: ./phicoin-qt-portable.sh"
echo ""
echo "Or set LD_LIBRARY_PATH manually:"
echo "  export LD_LIBRARY_PATH=\$(pwd)/qt5_libs:\$LD_LIBRARY_PATH"
echo "  ./phicoin-qt"
echo "=========================================="
