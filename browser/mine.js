// LICENSE_CODE JPL mine.js - browser mining api
import * as bitcoin from 'bitcoinjs-lib';
import sha256lif from './sha256lif.js';
const sha256 = bitcoin.crypto.sha256;
import {ewait, assert, ipc_postmessage} from './util.js';

export function hash256_pow(netconf, buf){
  if (netconf.pow=='sha256lif')
    return sha256lif.digest(Buffer.from(sha256(buf)));
  if (netconf.pow=='sha256' || !netconf.pow)
    return sha256(sha256(buf));
  throw Error('invalid pow');
}

export function target_rcmp(a, b){
  assert(a.length===b.length);
  for (let i = a.length-1; i>=0; i--){
    if (a[i] < b[i])
      return -1;
    if (a[i] > b[i])
      return 1;
  }
  return 0;
}

export function target_from_compact(compact){
  compact = BigInt(compact);
  if (!compact)
    return 0n;
  const exponent = compact >> 24n;
  const negative = (compact >> 23n) & 1n;
  let mantissa = compact & 0x7fffffn;
  let num;
  if (exponent <= 3n){
    mantissa >>= 8n * (3n-exponent);
    num = mantissa;
  } else
    num = mantissa << 8n * (exponent-3n);
  if (negative)
    num = -num;
  return num;
}

export function bigint_to_le(value, bytes){
  const a = new Uint8Array(bytes);
  for (let i=0; value>0n && i<32; i++){
    a[i] = Number(value & 0xFFn);
    value >>= 8n;
  }
  return a;
}

export function target_get(bits){
  const target = target_from_compact(bits);
  if (target<0)
    throw new Error('Target is negative.');
  if (!target)
    throw new Error('Target is zero.');
  return bigint_to_le(target, 32);
}

export function mine_single(netconf, header, target_a, nonce){
  header.writeUInt32LE(nonce, 76);
  let hash = hash256_pow(netconf, header);
  if (target_rcmp(hash, target_a)<=0){
    console.log('mine_single: found nonce', nonce);
    return {found: true, nonce};
  }
}

export function mine(netconf, header, min, max){
  let now = Math.round(Date.now()/1000);
  let time = header.readUInt32LE(68);
  let target_a = target_get(header.readUInt32LE(72));
  let v;
  for (let i=min; i<=max; i++){
    if (v=mine_single(netconf, header, target_a, i))
      return v;
  }
}

let mine_worker;
let mine_worker_wait;
let mine_ipc;
export async function mine_worker_init(){
  if (mine_worker_wait)
    return await mine_worker_wait;
  mine_worker_wait = ewait();
  mine_worker = new Worker(import.meta.resolve('./mine_worker.js'),
    {type: 'module'});
  mine_ipc = new ipc_postmessage();
  mine_ipc.connect(mine_worker);
  let v = await mine_ipc.cmd('version');
  console.log('connected to mine_worker version', v);
  return mine_worker_wait.return(mine_ipc);
}

export async function mine_worker_get(mine_cmd){
  let mine_ipc = await mine_worker_init();
  let res = await mine_ipc.cmd('mine', mine_cmd);
  console.log('got res', res);
}


