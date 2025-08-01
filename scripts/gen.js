'use strict';

function assert(v, msg){ if (v) return; debugger; throw Error('assert: '+msg); }
const Consensus = require('../lib/protocol/consensus');
const Networks = require('../lib/protocol/networks');
const TX = require('../lib/primitives/tx');
const Block = require('../lib/primitives/block');
const Script = require('../lib/script/script');

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
    reward = 50 * Consensus.COIN;

  const tx = new TX({
    version: 1,
    inputs: [{
      prevout: {
        hash: Consensus.ZERO_HASH,
        index: 0xffffffff
      },
      script: new Script()
        .pushInt(0x1d00ffff) // ~4G hashing attempts needed
        .pushPush(Buffer.from([4])) // on avarage even 1 nonce cycle (32^2).
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
    prevBlock: Consensus.ZERO_HASH,
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
  bits: 0x1d00ffff,
  nonce: 2083236893
});
nets.lif = createGenesisBlock({
  version: 1,
  time: 1753572481,
  bits: 0x207fffff,
  nonce: 2083236893 // need to mine this block to get a value
});

nets.testnet = createGenesisBlock({
  version: 1,
  time: 1296688602,
  bits: 0x1d010fff,
  nonce: 0x1d00ffff,
});

nets.regtest = createGenesisBlock({
  version: 1,
  time: 1296688602,
  bits: 0x207fffff,
  nonce: 2
});

nets.simnet = createGenesisBlock({
  version: 1,
  time: 1401292357,
  bits: 0x207fffff,
  nonce: 2
});

function diff_block(name, block, net_def){
  console.log('--------- '+name+' ---------------');
  0 && console.log(block);
  let hold = net_def.genesis.hash.reverse().toString('hex');
  let hnew = block.rhash();
  if (hold!=hnew)
    console.log('diff new: ', hnew);
  console.log('hash old: ', hnew);
  let bold = net_def.genesisBlock;
  let bnew = block.toRaw().toString('hex');
  if (bold!=bnew)
    console.log('diff new:', bnew);
  console.log('diff old:', bold);
}

const hash256 = require('bcrypto/lib/hash256');
const sha256 = require('../lif-node/sha256');
const sha256lif = require('../lif-node/sha256lif');
const mine = require('../lib/mining/mine');
const common = require('../lib/mining/common');
function rcmp(a, b) {
  assert(a.length === b.length);
  for (let i = a.length-1; i>=0; i--){
    let cmp = a[i]-b[i];
    if (cmp)
      return cmp;
  }
  return 0;
}
function mine_single(header, target, nonce){
  let hash;
  header.writeUInt32LE(nonce, 76, true);
  hash = sha256.digest(sha256.digest(header)); // 0.13M/sec
  //hash = sha256lif.digest(sha256lif.digest(header)); // 0.13M/sec
  //hash = hash256.digest(header); // 0.28M/sec
  let found = rcmp(hash, target)<=0;
  if (!found)
    return;
  console.log('found nonce', nonce, header.toString('hex'));
  return true;
}

function mine_range(header, target, min, max){
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
  console.log('mining...');
  let header = block.toRaw().slice(0, 80);
  let min = 2083236890; // nonce bitcoin genesis 2083236893
  let max = 0x100000000;
  let target = common.getTarget(block.bits);
  let inc = 1000000;
  let nonce = -1;
  for (let i=min; i<=max; i+=inc){
    let start = Date.now();
    let _max = Math.min(max, i+inc-1);
    //nonce = mine(header, target, i, _max); // 0.28M/sec
    nonce = mine_range(header, target, i, _max+1);
    console.log(nonce);
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

diff_block('main', nets.main, Networks.main);
1 && do_mine(nets.main);
process.exit(0);
diff_block('lif', nets.lif, Networks.lif);
diff_block('testnet', nets.testnet, Networks.testnet);
diff_block('regtest', nets.regtest, Networks.regtest);
diff_block('simnet', nets.simnet, Networks.simnet);
