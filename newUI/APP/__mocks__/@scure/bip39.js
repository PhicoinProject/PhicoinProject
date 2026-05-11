// CJS mock for @scure/bip39 - absolute path bypasses Jest moduleNameMapper
const realPkg = require('/media/runner/FILES/Phicoin_project/newUI/APP/node_modules/@scure/bip39');

module.exports = {
  mnemonicToSeedSync: realPkg.mnemonicToSeedSync,
  generateMnemonic: realPkg.generateMnemonic,
  validateMnemonic: realPkg.validateMnemonic,
  mnemonicToSeed: realPkg.mnemonicToSeed,
};
