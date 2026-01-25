#!/usr/bin/env node
'use strict'; /* eslint-env node */
process.title = 'gen';

const assert = require('bsert');
const consensus = require('../lib/protocol/consensus');
const Networks = require('../lib/protocol/networks');
const Network = require('../lib/protocol/network');
const TX = require('../lib/primitives/tx');
const MTX = require('../lib/primitives/mtx');
const Block = require('../lib/primitives/block');
const Script = require('../lib/script/script');
const Mnemonic = require('../lib/hd/mnemonic');
const HDPrivateKey = require('../lib/hd/private');
const KeyRing = require('../lib/primitives/keyring');

let nets = {};
function createGenesisBlock(options) {
  let flags = options.flags;
  let key = options.key;
  let reward = options.reward;
  if (!flags)
    flags = 'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks';
  if (typeof flags=='string')
    flags = Buffer.from(flags, 'ascii');
  if (!key) {
    key = Buffer.from(''
      + '04678afdb0fe5548271967f1a67130b7105cd6a828e039'
      + '09a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c3'
      + '84df7ba0b8d578a4c702b6bf11d5f', 'hex');
  }
  if (!reward)
    reward = 50 * consensus.COIN;
  const tx = new TX({
    version: 1,
    inputs: [{
      prevout: {
        hash: consensus.ZERO_HASH,
        index: 0xffffffff
      },
      script: new Script()
      .pushInt(0x1d00ffff) // ~4G hashing attempts needed
      .pushPush(Buffer.from([options.net_type=='lifmain' ? 2 : 4])) // on avarage even 1 nonce cycle (32^2).
      .pushData(flags)
      .compile(),
      sequence: 0xffffffff
    }],
    outputs: [{
      value: reward,
      script: Script.fromPubkey(key)
    }],
    locktime: 0
  });
  const block = new Block({
    version: options.version,
    prevBlock: consensus.ZERO_HASH,
    merkleRoot: tx.hash(),
    time: options.time,
    bits: options.bits,
    nonce: options.nonce,
    height: 0
  });
  block.txs.push(tx);
  return block;
}

nets.main = createGenesisBlock({
  version: 1,
  time: 1231006505,
  bits: 0x1d00ffff, nonce: 2083236893,
});
nets.lifmain = createGenesisBlock({
  version: 1,
  time: 1753572481,
  //bits: 0x1d00ffff, nonce: ???, // 256*10sec = 1hour
  //bits: 0x1e00ffff, nonce: ???, // 10sec
  bits: 0x1f00ffff, nonce: 29664, // 0.1sec fast
  net_type: 'lifmain',
});

nets.testnet = createGenesisBlock({
  version: 1,
  time: 1296688602,
  bits: 0x1d00ffff, nonce: 414098458,
});

nets.regtest = createGenesisBlock({
  version: 1,
  time: 1296688602,
  bits: 0x207fffff, nonce: 2,
});

nets.simnet = createGenesisBlock({
  version: 1,
  time: 1401292357,
  bits: 0x207fffff, nonce: 2,
});

function str_diff(a, b){
  let i;
  for (i=0; i<a.length; i++){
    if (a[i]!=b[i])
      break;
  }
  if (i==a.length && i==b.length)
    return -1;
  console.log('pos '+i+' diff: '+a.slice(i, i+8)+' -> '+b.slice(i, i+8));
  return i;
}
function diff_block(name, block, net_def){
  let err;
  console.log('--------- '+name+' ---------------');
  // complete block
  let b_orig = net_def.genesisBlock;
  let b_gen = block.toRaw().toString('hex');
  if (b_orig!=b_gen){
    console.log(err='ERR block gen:', b_gen);
    str_diff(b_orig, b_gen);
  }
  console.log('block orig:', b_orig);
  // check orig header hash matchs computed
  let h_orig = net_def.genesis.hash.toString('hex');
  let h_orig_comp = new Block().fromHead(Buffer.from(b_orig, 'hex')).hash()
    .toString('hex');
  if (h_orig!=h_orig_comp)
    console.log(err='ERR hash orig comp:', h_orig_comp);
  let h_gen = block.hash().toString('hex');
  if (h_gen!=h_orig)
    console.log(err='ERR hash gen:', h_gen);
  // check hash matches target
  if (mine_range(block.toRaw().slice(0, 80), null, block.nonce, block.nonce)<0){
    console.log(err='ERR target not reached:', '0x'+block.bits.toString(16),
      common.getTarget(block.bits));
  }
  console.log('hash orig:', h_orig);
  if (!err)
    console.log('SUCCESS');
}

const hash256 = require('bcrypto/lib/hash256');
const sha256 = require('bcrypto/lib/sha256');
const _sha256 = require('../lib/utils/sha256');
const sha256lif = require('../lib/utils/sha256lif');
const hash256lif = require('../lib/utils/hash256lif');
const mine = require('../lib/mining/mine');
const common = require('../lib/mining/common');
function mine_single(header, target, nonce){
  let hash;
  header.writeUInt32LE(nonce, 76, true);
  //hash = sha256.digest(sha256.digest(header)); // 0.22M/sec
  //hash = _sha256.digest(_sha256.digest(header)); // 0.33M/sec
  //hash = sha256lif.digest(_sha256.digest(header)); // 0.29M/sec
  //hash = hash256lif.digest(header); // 0.29M/sec
  //hash = hash256.digest(header); // 0.36M/sec
  hash = Network.get_pow_hash256().digest(header);
  let found = mine.rcmp(hash, target)<=0;
  if (!found)
    return;
  console.log('found nonce', nonce, header.toString('hex'));
  return true;
}

function mine_range(header, target, min, max){
  if (!target)
    target = common.getTarget(header.readUInt32LE(72));
  if (0)
    return mine(header, target, min, max); // 0.28M/sec
  for (let nonce=min; nonce<=max; nonce++){
    if (mine_single(header, target, nonce))
      return nonce;
  }
  return -1;
}

function do_mine(block){
  // $ speed -bytes 80 sha256
  // Doing sha256 for 3s on 80 size blocks: 4368155 sha256's in 2.98s
  // so does 1.3M/sec (nodeJS native).
  // For bitcoin block double hashing: 0.77M/sec.
  // to reach 4G - needs 5000 sec. Thats more than one hour
  // sha256.digest(header); --> 0.25M/sec (6 times slower than NodeJS native)
  console.log('-------------- mining... ---------------');
  let header = block.toRaw().slice(0, 80);
  let min = 0; // nonce bitcoin genesis 2083236893
  let max = 0x100000000;
  let target = common.getTarget(block.bits);
  console.log('difficulty:', block.bits.toString(16), target.toString('hex'));
  let inc = 1000000;
  let nonce = -1;
  for (let i=min; i<=max; i+=inc){
    let start = Date.now();
    let _max = Math.min(max, i+inc-1);
    nonce = mine_range(header, target, i, _max);
    if (nonce>=0)
      break;
    let tm = Date.now()-start;
    console.log(tm+'ms at '+i+' '+(inc/tm/1000)+'M/sec');
  }
  if (nonce<0){
    console.log('failed mining');
    return;
  }
  console.log('SUCCESS: nonce='+nonce, header.toString('hex'));
  return nonce;
}

function do_test(){
  diff_block('main', nets.main, Networks.main);
  Network.set('lifmain');
  diff_block('lifmain', nets.lifmain, Networks.lifmain);
  Network.set();
  diff_block('testnet', nets.testnet, Networks.testnet);
  diff_block('regtest', nets.regtest, Networks.regtest);
  diff_block('simnet', nets.simnet, Networks.simnet);
  0 && do_mine(nets.main);
  Network.set('lifmain');
  1 && do_mine(nets.lifmain);
  Network.set();
}

function bech32(mnemonic){
  const _mnemonic = Mnemonic.fromPhrase(mnemonic);
  const hdPrivKey = HDPrivateKey.fromMnemonic(_mnemonic);
  const derivedKey = hdPrivKey.derive(84, true)
  .derive(0, true).derive(0, true).derive(0).derive(0);
  const keyRing = new KeyRing({privateKey: derivedKey.privateKey,
    witness: true});
  const net = Network.get();
  const address = keyRing.getKeyAddress('string', net);
  return {
    privateKey: derivedKey.privateKey.toString('hex'),
    publicKey: keyRing.publicKey.toString('hex'),
    address: address,
    keyRing: keyRing
  };
}
let wallet1 = 'six clip senior spy fury aerobic volume sheriff critic number feature inside';
let wallet1_a = bech32(wallet1);
let wallet2 = 'morning like hello gym core stage wood deposit artefact monster turn absorb';
let wallet2_a = bech32(wallet1);

function do_tx(){
  Network.set('lifmain');
  Network.set();
}

if (!process.browser)
  do_test();
module.exports = {do_test, do_tx};

