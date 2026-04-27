// LICENSE_CODE JPL mine.js - browser mining api
import sha256lif from './sha256lif.js';
import sha256 from './sha256.js';
import {ewait, esleep, assert, ipc_postmessage} from './util.js';

let D = 0;

export function hash256_pow(pow, buf){
  if (pow=='sha256lif')
    return sha256lif.digest(sha256.digest(buf));
  if (pow=='sha256' || !pow)
    return sha256.digest(sha256.digest(buf));
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

export function target_to_nhash_win(target){
  return (2n ** 256n)/(target + 1n);
}

export function bigint_to_buf_le(value, bytes){
  const a = new Buffer(bytes);
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
  return bigint_to_buf_le(target, 32);
}

export function header_get_time(header){
  return header.readUInt32LE(68);
}
export function header_get_target(header){
  return header.readUInt32LE(72);
}
export function header_get_nonce(header){
  return header.readUInt32LE(76);
}
export function header_set_nonce(header, nonce){
  header.writeUInt32LE(nonce, 76);
}
export function header_set_time(header, time){
  header.writeUInt32LE(time, 68);
}

export function mine_single(pow, header, target_a, nonce){
  header_set_nonce(header, nonce);
  let hash = hash256_pow(pow, Buffer.from(header));
  if (target_rcmp(hash, target_a)<=0){
    D && console.log('mine_single: found nonce', nonce);
    return {found: true, nonce};
  }
}

export function date_time(){
  return Math.floor(Date.now()/1000);
}
export function mine({pow, header, min, max}){
  let target_a = target_get(header_get_target(header));
  let v;
  for (let i=min; i<max; i++){
    if (v=mine_single(pow, header, target_a, i))
      return {...v, header};
  }
}

let mine_worker;
let mine_worker_wait;
let mine_ipc;
export async function mine_worker_init(){
  if (mine_worker_wait)
    return await mine_worker_wait;
  mine_worker_wait = ewait();
  console.log('mine_worker_init.js');
  mine_worker = new Worker(import.meta.resolve('./mine_worker_init.js'),
    {type: 'module'});
  mine_ipc = new ipc_postmessage();
  mine_ipc.connect(mine_worker);
  let v = await mine_ipc.cmd('version');
  console.log('connected to mine_worker version', v);
  return mine_worker_wait.return(mine_ipc);
}

export async function mine_worker_call(mine_cmd){
  let mine_ipc = await mine_worker_init();
  let opt = {...mine_cmd};
  opt.header = opt.header.toString('hex');
  let ret = await mine_ipc.cmd('mine', opt);
  console.log('got ret', ret);
  if (ret.header)
    ret.header = Buffer.from(ret.header, 'hex');
  return ret;
}

export async function mine_steps({pow, header, time_local, min, max,
  on_update})
{
  let hps = 10; // initial hashs per second. in reality is around 1M hps
  let slice_ms = 100;
  let total_h = 0;
  let at = min;
  let time_diff = header_get_time(header)-time_local;
  let time_last = time_local;
  let _header = Buffer.from(header);
  let nhash_win = Number(target_to_nhash_win(
    target_from_compact(header_get_target(header))));
  for (;;){
    let slice_h = Math.floor(hps*1000/slice_ms+1);
    let up = on_update({hps, slice_h, total_h, nhash_win});
    if (up?.stop)
      return {stop: true, total_h};
    let time = date_time();
    if (time!=time_last){
      header_set_time(_header, time+time_diff);
      time_last = time;
      at = min;
    }
    let tstart = Date.now();
    let ret = await mine_worker_call({pow, header: _header,
      min: at, max: Math.min(at+slice_h, 0x100000000)});
    if (ret.found)
      return {...ret, total_h};
    let tend = Date.now();
    let ms = tend-tstart;
    total_h += slice_h;
    if (ms<slice_ms)
      slice_h = Math.round(slice_h * slice_ms/(ms+1));
    hps = slice_h*1000/slice_ms;
    at += slice_h;
    if (at>=max){
      console.warn('mine reached nonce end of slice');
      await esleep(slice_ms);
    }
  }
  return {found: false, total_h};
}

function test(){
  let t;
  t = (v, res)=>assert.eq(target_to_nhash_win(v), res);
  t(0x00000000ffff0000000000000000000000000000000000000000000000000000n,
    4295032833n);
  t(0x0000ffff00000000000000000000000000000000000000000000000000000000n,
    65537n);
  t = (v, res)=>assert.eq(target_from_compact(v), res);
  t(0x1d00ffff, 
    0x00000000ffff0000000000000000000000000000000000000000000000000000n);
  t = (v, res)=>assert.eq(bigint_to_buf_le(v, 32).toString('hex'), res);
  t(0x00000000ffff0000000000000000000000000000000000000000000000000000n,
    '0000000000000000000000000000000000000000000000000000ffff00000000');
  t = (v, res)=>assert.eq(target_get(v).toString('hex'), res);
  t(0x1d00ffff, 
    '0000000000000000000000000000000000000000000000000000ffff00000000');
  t(0x1f00ffff,
    '00000000000000000000000000000000000000000000000000000000ffff0000');
  t = (header, pow, min, max, v)=>assert.eq(mine(
    {pow, header: Buffer.from(header, 'hex'), min, max})?.nonce, v);
  let header = '00000020d7da75d79cff74f6a9896d6445a4abb9d283cfb5df37bdcc8d886bfdd441000085ea5bf430856f0ba4e80515b9fc45bf8ef837a2da8c5b8ab1fadc5f6b7c37d5fabbee69ffff001ff52d0100';
  t(header, 'sha256lif', 77290, 77310, 77301);
  t(header, 'sha256lif', 77302, 77310, undefined);
  t(header, 'sha256', 53830, 53850, 53840);
  t(header, 'sha256', 53841, 53850, undefined);
}
test();
