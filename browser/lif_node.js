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
const Output = require('../lib/primitives/output');
const MTX = require('../lib/primitives/mtx');
const Coin = require('../lib/primitives/coin');
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
let wallet1_a = bech32(wallet1);
let wallet2 = 'morning like hello gym core stage wood deposit artefact monster turn absorb';
let wallet2_a = bech32(wallet2);

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
let mine_address = bech32(wallet1).address;
console.log(`Mining address calculated: ${mine_address}`);

async function mineBlocks(n){
  const chain = node.chain;
  const miner = new Miner({chain});
  const entries = [];
  const miningAddress = new Address(mine_address);
  console.log(`Mining ${n} blocks to address: ${mine_address}`);
  for (let i = 0; i < n; i++){
    const job = await miner.cpu.createJob(null, miningAddress);
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
  console.error(err);
  throw err;
});
process.on('SIGINT', async()=>{
  await node.close();
});

async function do_start(){
  await node.ensure();
  await node.open();
  await node.connect();
  node.startSync();
}

async function do_mine(){
  await mineBlocks(5);
}

function mtx_fund(mtx, {coins, fee, change_addr}){
  let out_val = fee;
  for (let out of mtx.tx.outputs)
    out_val += out.value;
  // Add coins to transaction.
  let in_val = 0;
  for (let coin of coins){
    mtx.addCoin(coin);
    in_val += coin.value;
    if (in_val>=out_val)
      break;
  }
  if (in_val<out_val){
    console.err('not enough funds');
    throw 'not enough funds';
  }
  if (in_val>out_val){
    assert(change_addr, 'tx change: missing change_addr');
    let output = new Output();
    output.value = in_val-out_val;
    output.script.fromAddress(change_addr);
    this.changeIndex = this.outputs.length-1;
  }
}

function tx_get_coins_by_addr(tx, addr_h){
  let coins = [];
  for (let i = 0; i < tx.outputs.length; i++) {
    let addr = tx.outputs[i].getAddress();
    let h = addr.getHash();
    if (!h||addr_h!=h)
      continue;
    coins.push(Coin.fromTX(tx.hash, i));
  }
  return coins;
}
async function node_get_coins(addr){
  let txs = await node.getMetaByAddress(addr);
  let coins = [];
  for (let t of txs)
    coins.push(...tx_get_coins_by_addr(t.tx, addr));
  return coins;
}

async function mtx_send_create({from, to, value, change, fee}){
  let mtx = new MTX();
  let send = 10000;
  let coins = await node_get_coins(from.address);
  let funds = coins.reduce((v, coin)=>v||0+coin.value);
  console.log(tx);
  mtx.addOutput({address: to, value});
  for (let coin of coins)
    mtx.addCoin(coin);
  mtx.sign(from.keyring);
  assert(mtx.verify());
  let tx = mtx.toTX();
  assert(tx.verify(mtx.view));
  return mtx;
}

async function do_tx({from, to, amount, change, fee}){
  await do_start();
  debugger;
  let mtx = mtx_send_create({from: wallet1_a, to: wallet2_a, value: 10000,
    fee: 1000});
  let res = await node.sendTX(mtx.tx);
  await mineBlocks(1);
}

async function main(){
  await do_start();
  if (mine)
    await do_mine();
}
if (!process.browser)
  main();
module.exports = {do_start, do_mine};
