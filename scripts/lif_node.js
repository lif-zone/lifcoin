#!/usr/bin/env node
'use strict';
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

const node = new FullNode({
  network: 'lif', // 'main'
  file: false,
  argv: true,
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

function bech32_address(mnemonicPhrase){
  const mnemonic = Mnemonic.fromPhrase(mnemonicPhrase);
  const hdPrivKey = HDPrivateKey.fromMnemonic(mnemonic);
  const derivedKey = hdPrivKey.derive(44, true)
  .derive(0, true).derive(0, true).derive(0).derive(0);
  const keyRing = new KeyRing({privateKey: derivedKey.privateKey,
    witness: true});
  const net = Network.get();
  // For LIF network, update bech32 prefix to 'lif'
  console.log(net.addressPrefix); // bc? lif?
  const address = keyRing.getKeyAddress('string', net);
  return {
    privateKey: derivedKey.privateKey.toString('hex'),
    publicKey: keyRing.publicKey.toString('hex'),
    address: address,
    keyRing: keyRing
  };
}

let mine = 1; //process.argv.includes('mine');
let mine_priv = 'six clip senior spy fury aerobic volume sheriff critic number feature inside';
let mine_address = null; //bech32_address(mine_priv).address;
//console.log(`Mining address calculated: ${mine_address}`); 

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
main();
