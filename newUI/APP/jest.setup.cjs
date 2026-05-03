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
