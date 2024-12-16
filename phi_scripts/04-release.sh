# Compress the Linux directory
tar -cvf ./release/linux_64.tar ./release/linux

# Compress the Windows directory
tar -cvf ./release/win_64.tar ./release/win

# Calculate SHA256 hashes and write to README.MD
echo "## File SHA256 Hashes" > ./release/README.MD
echo "" >> ./release/README.MD
echo "### ./release/linux_64.tar" >> ./release/README.MD
sha256sum ./release/linux_64.tar >> ./release/README.MD
echo "" >> ./release/README.MD
echo "### ./release/win_64.tar" >> ./release/README.MD
sha256sum ./release/win_64.tar >> ./release/README.MD