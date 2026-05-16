/**
 * Test asset issuance using daemon's signrawtransaction RPC
 * to verify the serialization + signing flow.
 */
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { base58 } from '@scure/base';

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToArray(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}
function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}
function hash160(data) { return ripemd160(sha256(data)); }

async function rpcCall(method, params = []) {
  const auth = Buffer.from('phi:phi').toString('base64');
  const resp = await fetch('http://127.0.0.1:28966/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', method, params, id: 1 }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`RPC ${method} error ${data.error.code}: ${data.error.message.substring(0, 200)}`);
  return data.result;
}

async function main() {
  // Step 1: Derive test address + private key
  const PUB_KEY_HASH = 0x38;
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const seed = mnemonicToSeedSync(mnemonic, '');
  const hdKey = HDKey.fromMasterSeed(seed);
  const derived = hdKey.derive("m/0'/0'/0'/0/0");
  const pubKey = derived.publicKey;
  const pkHex = toHex(derived.privateKey);

  const compressed = pubKey.length === 33 ? pubKey : new Uint8Array([pubKey[64] & 1 ? 0x03 : 0x02, ...pubKey.slice(1, 33)]);
  const h160 = hash160(compressed);

  const payload = new Uint8Array(21);
  payload[0] = PUB_KEY_HASH; payload.set(h160, 1);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const address = base58.encode(concatBytes(payload, checksum));

  const script = new Uint8Array(25);
  script[0] = 0x76; script[1] = 0xa9; script[2] = 0x14;
  script.set(h160, 3); script[23] = 0x88; script[24] = 0xac;
  const scriptPubKey = toHex(script);

  console.log('=== Step 1: Derived key ===');
  console.log('Address:', address);
  console.log('scriptPubKey:', scriptPubKey);
  console.log('privateKey:', pkHex);

  // Step 2: Import private key to daemon
  console.log('\n=== Step 2: Import key to daemon ===');
  try {
    await rpcCall('importprivkey', [pkHex, 'testkey', false]);
    console.log('Imported private key');
  } catch (e) {
    if (e.message.includes('already') || e.message.includes('import')) {
      console.log('Key already imported');
    } else {
      throw e;
    }
  }

  // Step 3: Check UTXOs for this address
  console.log('\n=== Step 3: Check UTXOs ===');
  let utxos = await rpcCall('getaddressutxos', [{ addresses: [address] }]);
  console.log('UTXOs:', utxos.length);

  if (utxos.length === 0) {
    console.log('No UTXOs. Checking daemon wallet balance...');
    const balance = await rpcCall('getbalance');
    console.log('Daemon balance:', balance);

    if (balance > 0.1) {
      console.log('Sending from daemon to test address...');
      const txid = await rpcCall('sendtoaddress', [address, Math.min(balance - 0.01, 1)]);
      console.log('Sent, txid:', txid);
      // Wait for next block to confirm
      utxos = await rpcCall('getaddressutxos', [{ addresses: [address] }]);
      console.log('UTXOs after send:', utxos.length);
    } else {
      console.log('Daemon has no balance. Mining 101 blocks...');
      try {
        const blocks = await rpcCall('generatetoaddress', [101, address]);
        console.log('Mined', blocks.length, 'blocks');
      } catch (e) {
        console.log('Mining failed:', e.message.substring(0, 200));
        process.exit(1);
      }
    }
  }

  utxos = await rpcCall('getaddressutxos', [{ addresses: [address] }]);
  console.log('\nFinal UTXOs:', utxos.length);

  if (utxos.length === 0) {
    console.log('FATAL: Still no UTXOs after mining.');
    process.exit(1);
  }

  const utxo = utxos[0];
  console.log('txid:', utxo.txid);
  console.log('vout:', utxo.outputIndex);
  console.log('satoshis:', utxo.satoshis);
  console.log('script:', utxo.script);

  // Step 4: Build asset script
  console.log('\n=== Step 4: Build asset script ===');
  const assetName = 'CLI' + Math.floor(Date.now() / 1000).toString().slice(-6);
  const amountSat = BigInt(1000 * Math.pow(10, 8));
  const units = 8;
  const reissuable = 0;
  const hasIPFS = 0;

  const nameBytes = new TextEncoder().encode(assetName);
  const totalLen = nameBytes.length + 8 + 1 + 1 + 1;
  const assetData = new Uint8Array(totalLen);
  let off = 0;
  assetData[off++] = nameBytes.length;
  assetData.set(nameBytes, off); off += nameBytes.length;
  const amtBuf = new Uint8Array(8);
  new DataView(amtBuf.buffer).setBigUint64(0, amountSat, true);
  assetData.set(amtBuf, off); off += 8;
  assetData[off++] = units;
  assetData[off++] = reissuable;
  assetData[off++] = hasIPFS;

  const magic = new Uint8Array([0x72, 0x76, 0x6e, 0x71]);
  const payloadData = concatBytes(magic, assetData);
  const assetScript = new Uint8Array(1 + 1 + payloadData.length + 1);
  assetScript[0] = 0xc0;
  assetScript[1] = payloadData.length;
  assetScript.set(payloadData, 2);
  assetScript[2 + payloadData.length] = 0x61;
  const assetScriptHex = toHex(assetScript);

  console.log('Asset:', assetName);
  console.log('Serialized data:', toHex(assetData));
  console.log('Asset script:', assetScriptHex);

  // Step 5: Build raw transaction using daemon's createrawtransaction
  console.log('\n=== Step 5: Build raw tx via createrawtransaction ===');
  const inputSat = utxo.satoshis;
  const assetOutputValue = 1000;
  const feeSat = 10000;
  const changeValue = inputSat - feeSat - assetOutputValue;

  if (changeValue < 0) {
    console.log('UTXO too small:', inputSat, 'sat');
    process.exit(1);
  }

  const inputs = [{ txid: utxo.txid, vout: utxo.outputIndex }];
  const outputs = {};
  outputs[assetScriptHex] = Number((assetOutputValue / 1e8).toFixed(8));
  outputs[address] = Number((changeValue / 1e8).toFixed(8));

  console.log('Inputs:', JSON.stringify(inputs));
  console.log('Outputs:', JSON.stringify(outputs));

  const rawHex = await rpcCall('createrawtransaction', [inputs, outputs]);
  console.log('Raw tx:', rawHex.substring(0, 80) + '...');

  const decoded = await rpcCall('decoderawtransaction', [rawHex]);
  console.log('Decoded txid:', decoded.txid);
  console.log('vout[0] (asset) type:', decoded.vout[0].scriptPubKey.type);
  console.log('vout[1] (change) addr:', decoded.vout[1].scriptPubKey.addresses);

  // Step 6: Sign using signrawtransaction with private key
  console.log('\n=== Step 6: Sign with signrawtransaction ===');
  const prevTxs = [{
    txid: utxo.txid,
    vout: utxo.outputIndex,
    scriptPubKey: utxo.script,
    amount: Number((utxo.satoshis / 1e8).toFixed(8)),
  }];
  const privKeys = [pkHex];

  const signedResult = await rpcCall('signrawtransaction', [rawHex, prevTxs, privKeys]);
  console.log('complete:', signedResult.complete);
  console.log('hex:', signedResult.hex.substring(0, 80) + '...');
  if (signedResult.errors && signedResult.errors.length) {
    console.log('Errors:', JSON.stringify(signedResult.errors));
  }

  // Step 7: Verify signed tx
  console.log('\n=== Step 7: Verify signed tx ===');
  const decodedSigned = await rpcCall('decoderawtransaction', [signedResult.hex]);
  console.log('txid:', decodedSigned.txid);
  console.log('vin[0] scriptsig:', decodedSigned.vin[0].scriptsig?.hex?.substring(0, 40) || decodedSigned.vin[0].scriptSig?.hex?.substring(0, 40) || 'none');

  // Step 8: testmempoolaccept
  console.log('\n=== Step 8: testmempoolaccept ===');
  try {
    const mempool = await rpcCall('testmempoolaccept', [signedResult.hex, false]);
    console.log('Result:', JSON.stringify(mempool[0]));
  } catch (e) {
    console.log('Error:', e.message.substring(0, 200));
  }

  // Step 9: sendrawtransaction
  console.log('\n=== Step 9: sendrawtransaction ===');
  try {
    const txid = await rpcCall('sendrawtransaction', [signedResult.hex, true]);
    console.log('\n*** SUCCESS! ***');
    console.log('Asset "' + assetName + '" issued!');
    console.log('txid:', txid);
  } catch (e) {
    console.log('FAILED:', e.message.substring(0, 300));
  }
}

main().catch(e => console.error(e));
