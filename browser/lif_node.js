#!/usr/bin/env node
'use strict'; /* eslint-env node */
process.title = 'lif_node';
const Network = require('../lib/protocol/network');
Network.set('lif');
const consensus = require('../lib/protocol/consensus');
const FullNode = require('../lib/node/fullnode');
const Miner = require('../lib/mining/miner');
const Mnemonic = require('../lib/hd/mnemonic');
const HDPrivateKey = require('../lib/hd/private');
const KeyRing = require('../lib/primitives/keyring');
const Address = require('../lib/primitives/address');
const assert = require('bsert');

const node = new FullNode({
  network: 'lif', // 'main'
  file: false,
  argv: [],
  env: true,
  logFile: true,
  logConsole: true,
  logLevel: 'info',
  memory: false,
  workers: true,
  listen: true,
  //loader: require,
  prefix: '~/lif.store',
  coinbaseFlags: 'mined by lif-coin',
});

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
function test(){
  let type = Network.type;
  Network.set('main');
  assert.strictEqual(bech32(wallet1).address, 
    'bc1qe5trcka3qtt2ll8exe3xmt7qzyjjp6dfqp76xr');
  Network.set('testnet');
  assert.strictEqual(bech32(wallet1).address, 
    'tb1qe5trcka3qtt2ll8exe3xmt7qzyjjp6df289fas');
  Network.set('lif');
  assert.strictEqual(bech32(wallet1).address, 
    'lif1qe5trcka3qtt2ll8exe3xmt7qzyjjp6dfazcpj5');
  Network.set(type);
}
test();

let dna = 'DNAINDIVIDUALTRANSPARENTEFFECTIVEIMMEDIATEAUTONOMOUSINCREMENTALRESPONSIBLEACTIONTRUTHFUL';
let mine = 1; //process.argv.includes('mine');
let mine_wallet = wallet1;
let mine_address = bech32(mine_wallet).address;
console.log(`Mining address calculated: ${mine_address}`);

async function mineBlocks(n){
  const chain = node.chain;
  const miner = new Miner({chain});
  const entries = [];
  //const miningAddress = new Address(mine_address);
  const addresses = null; //[miningAddress];
  console.log(`Mining ${n} blocks to address: ${mine_address}`);
  for (let i = 0; i < n; i++){
    const job = await miner.cpu.createJob(null /*{addresses}*/);
    // Mine blocks all ten minutes apart from regtest genesis
    //job.attempt.time = chain.tip.time + (60 * 10); // fake time
    const block = await job.mineAsync();
    console.log(`Mined block ${i + 1}/${n}: ${block.hash().toString('hex')}`);
    const entry = await chain.add(block);
    entries.push(entry);
  }
  
  console.log(`Successfully mined ${n} blocks!`);
  return entries;
}

process.on('unhandledRejection', (err, promise)=>{
  throw err;
});
process.on('SIGINT', async()=>{
  await node.close();
});

async function _main(){
  await node.ensure();
  await node.open();
  await node.connect();
  node.startSync();
  if (mine)
    await mineBlocks(5);
}

async function main(){
  try {
    _main();
  } catch(err){
    console.error(err.stack);
    process.exit(1);
  }
}
module.exports = main;
