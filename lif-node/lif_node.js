#!/usr/bin/env node
'use strict';
process.title = 'lif_node';
const FullNode = require('../lib/node/fullnode');

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

// Temporary hack
if (!node.config.bool('no-wallet') && !node.has('walletdb')) {
  const plugin = require('../lib/wallet/plugin');
  node.use(plugin);
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
