// Jest setup - polyfill browser APIs for Node.js environment
const NodeCrypto = require('crypto');

global.crypto = {
  getRandomValues: function (buffer) {
    return NodeCrypto.randomFillSync(buffer);
  },
  subtle: NodeCrypto.webcrypto.subtle,
  randomUUID: function () {
    return NodeCrypto.randomUUID();
  },
};

// Initialize @noble/secp256k1 for sync signing (required by signSync/sign)
const { hmac } = require('@noble/hashes/hmac');
const { sha256 } = require('@noble/hashes/sha256');
const nobleSecp = require('@noble/secp256k1');
const hmacSha256 = (key, ...msgs) => {
  const data = Buffer.concat(msgs.map(m => Buffer.from(m)));
  return hmac(sha256, data, key);
};
nobleSecp.utils.hmacSha256Sync = hmacSha256;

// Polyfill localStorage
const store = {};
global.localStorage = {
  getItem: (key) => store[key] || null,
  setItem: (key, value) => { store[key] = String(value); },
  removeItem: (key) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
  get length() { return Object.keys(store).length; },
  key: (i) => Object.keys(store)[i] || null,
};

// Polyfill sessionStorage
const sessionStore = {};
global.sessionStorage = {
  getItem: (key) => sessionStore[key] || null,
  setItem: (key, value) => { sessionStore[key] = String(value); },
  removeItem: (key) => { delete sessionStore[key]; },
  clear: () => { for (const k in sessionStore) delete sessionStore[k]; },
  get length() { return Object.keys(sessionStore).length; },
  key: (i) => Object.keys(sessionStore)[i] || null,
};

// Polyfill TextEncoder/TextDecoder
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Polyfill Vite's import.meta.env for Node.js / Jest
// Vite injects these at build time; Jest has no equivalent.
if (typeof global.importMetaEnv === 'undefined') {
  global.importMetaEnv = {
    DEV: process.env.NODE_ENV !== 'production',
    PROD: process.env.NODE_ENV === 'production',
    SSR: false,
    BASE_URL: '/',
  };
}
