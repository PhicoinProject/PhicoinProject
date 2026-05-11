// CJS mock for @scure/bip32 - absolute path bypasses Jest moduleNameMapper
const realPkg = require('/media/runner/FILES/Phicoin_project/newUI/APP/node_modules/@scure/bip32');

module.exports = {
  HDKey: realPkg.HDKey,
};
