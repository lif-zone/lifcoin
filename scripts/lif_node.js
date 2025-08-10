#!/usr/bin/env node
'use strict';
process.title = 'lif_node';
const consensus = require('../lib/protocol/consensus');
const FullNode = require('../lib/node/fullnode');
const Miner = require('../lib/mining/miner');

consensus.set_type('lif');
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

let mine = 1; //process.argv.includes('mine');
async function mineBlocks(n){
  const chain = node.chain;
  const miner = new Miner({chain});
  const entries = [];
  for (let i = 0; i < n; i++){
    const job = await miner.cpu.createJob();
    // Mine blocks all ten minutes apart from regtest genesis
    //job.attempt.time = chain.tip.time + (60 * 10); // fake time
    const block = await job.mineAsync();
    0 && console.log('mined block:', block.format());
    const entry = await chain.add(block);
    entries.push(entry);
  }
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
