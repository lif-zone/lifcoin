#!/usr/bin/env node
const base58 = require('bcrypto/lib/encoding/base58');
const hash256 = require('bcrypto/lib/hash256');

function buildBuffer(version) {
  const buf = Buffer.alloc(78);
  buf.writeUInt32BE(version, 0);
  buf.writeUInt8(0, 4); // depth
  buf.writeUInt32BE(0, 5); // parent fingerprint
  buf.writeUInt32BE(0, 9); // child index
  // chain code (13-44): zeros
  // key (45-77): 0x00 + 32 zeros
  const checksum = hash256.digest(buf).slice(0, 4);
  return Buffer.concat([buf, checksum]);
}

function getPrefix(version) {
  const fullBuf = buildBuffer(version);
  const encoded = base58.encode(fullBuf);
  return encoded.substring(0, 4);
}

function findMin(prefix) {
  let low = 0;
  let high = 0xffffffff;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (getPrefix(mid) < prefix) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return getPrefix(low) === prefix ? low : null;
}

function findMax(prefix) {
  let low = 0;
  let high = 0xffffffff;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (getPrefix(mid) <= prefix) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return getPrefix(high) === prefix ? high : null;
}

function xpub_find(prefix){
  const minV = findMin(prefix);
  const maxV = findMax(prefix);
  const midV = minV !== null && maxV !== null ? Math.floor((minV + maxV) / 2) : null;
  console.log(`${prefix} Min: 0x${minV.toString(16)}`);
  console.log(`${prefix} Mid: 0x${midV.toString(16)}`);
  console.log(`${prefix} Max: 0x${maxV.toString(16)}`);
}

xpub_find('Lpub');
xpub_find('Lprv');
