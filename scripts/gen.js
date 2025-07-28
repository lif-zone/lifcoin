'use strict';

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
  let hold = block.rhash();
  let hnew = net_def.genesis.hash.reverse().toString('hex');
  if (hold!=hnew)
    console.log('diff new: ', hnew);
  console.log('hash old: ', hnew);
  let bold = block.toRaw().toString('hex');
  let bnew = net_def.genesisBlock;
  if (bold!=bnew)
    console.log('diff new:', bnew);
  console.log('diff old:', bold);
}

diff_block('main', nets.main, Networks.main);
process.exit(0);
diff_block('lif', nets.lif, Networks.lif);
diff_block('testnet', nets.testnet, Networks.testnet);
diff_block('regtest', nets.regtest, Networks.regtest);
diff_block('simnet', nets.simnet, Networks.simnet);
