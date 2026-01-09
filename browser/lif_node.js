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
const ewait = ()=>{
  let _return, _throw;
  let promise = new Promise((resolve, reject)=>{
    _return = ret=>{ resolve(ret); return ret; };
    _throw = err=>{ reject(err); return err; };
  });
  promise.return = _return;
  promise.throw = _throw;
  promise.catch(err=>{}); // catch un-waited wait() objects. avoid Uncaught in promise
  return promise;
};

let node = new FullNode({
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
  'index-tx': true,
  'index-address': true,
  'reject-absurd-fees': false,
  cors: true,
});

function bech32(mnemonic){
  let _mnemonic = Mnemonic.fromPhrase(mnemonic);
  let hdPrivKey = HDPrivateKey.fromMnemonic(_mnemonic);
  let derivedKey = hdPrivKey.derive(84, true)
  .derive(0, true).derive(0, true).derive(0).derive(0);
  let keyRing = new KeyRing({privateKey: derivedKey.privateKey,
    witness: true});
  let net = Network.get();
  let address = keyRing.getKeyAddress('string', net);
  let a = new Address(address);
  return {
    mn: mnemonic, // for dev
    privateKey: derivedKey.privateKey.toString('hex'),
    publicKey: keyRing.publicKey.toString('hex'),
    address: address,
    keyRing: keyRing,
    a,
  };
}

let wallet1 = bech32('six clip senior spy fury aerobic volume sheriff critic number feature inside');
let wallet2 = bech32('morning like hello gym core stage wood deposit artefact monster turn absorb');

function test(){
  let type = Network.type;
  let t = (net, addr)=>{
    Network.set(net);
    assert.strictEqual(bech32(wallet1.mn).address. addr);
  };
  t('main', 'bc1qe5trcka3qtt2ll8exe3xmt7qzyjjp6dfqp76xr');
  t('testnet', 'tb1qe5trcka3qtt2ll8exe3xmt7qzyjjp6df289fas');
  t('lif', 'lif1qe5trcka3qtt2ll8exe3xmt7qzyjjp6dfazcpj5');
  Network.set(type);
}
test();

let dna = 'DNAINDIVIDUALTRANSPARENTEFFECTIVEIMMEDIATEAUTONOMOUSINCREMENTALRESPONSIBLEACTIONTRUTHFUL';
let mine = 1; //process.argv.includes('mine');
let mine_address = wallet1.address;
console.log(`Mining address calculated: ${mine_address}`);

async function mineBlocks(n){
  let chain = node.chain, mempool = node.mempool;
  let miner = new Miner({chain, mempool});
  let entries = [];
  let miningAddress = new Address(mine_address);
  console.log(`Mining ${n} blocks to address: ${mine_address}`);
  for (let i = 0; i < n; i++){
    let job = await miner.cpu.createJob(null, miningAddress);
    // Mine blocks all ten minutes apart from regtest genesis
    //job.attempt.time = chain.tip.time + (60 * 10); // fake time
    let block = await job.mineAsync();
    console.log(`Mined block ${i + 1}/${n}: ${block.hash().toString('hex')}`);
    let entry = await chain.add(block);
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

async function Ewait(e, name){
  let wait = ewait();
  e.once('name', a=>wait.return(a));
  return await wait;
}
async function wait_for_sync_full(){
  console.log('waiting for full');
  console.log(node.chain.isFull());
  let ret = await Ewait(node, 'full');
  console.log('got full');
}
async function do_start(){
  await node.ensure();
  await node.open();
  await node.connect();
  await node.startSync();
  //await wait_for_sync_full();
}

async function do_mine(){
  await mineBlocks(5);
}

function mtx_fund(mtx, {coins, fee, change}){
  let out_val = fee;
  for (let out of mtx.outputs)
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
    console.error('not enough funds. need '+out_val+' got only '+in_val);
    throw 'not enough funds';
  }
  if (in_val>out_val){
    assert(change, 'tx change: missing change addr');
    let output = new Output();
    output.value = in_val-out_val;
    output.script.fromAddress(change);
    mtx.changeIndex = mtx.outputs.length-1;
  }
}

async function tx_get_coins_by_addr(txm, addr, spent){
  let coins = [], coin;
  for (let i=0; i<txm.tx.outputs.length; i++) {
    let a = txm.tx.outputs[i].getAddress();
    if (!a||!a.equals(addr))
      continue;
    if (spent){ // include also spent coins
      coins.push(Coin.fromTX(txm.tx, i, txm.height));
      continue;
    }
    if (!(coin = await node.chain.getCoin(txm.tx.hash(), i)))
      continue;
    coins.push(coin);
  }
  return coins;
}
async function node_get_coins(addr){
  let txs = await node.getMetaByAddress(addr);
  let coins = [];
  for (let t of txs)
    coins.push(...await tx_get_coins_by_addr(t, addr, false));
  return coins;
}

function coins_print(coins, s){
  s ||= '';
  for (let c of coins)
    console.log(s+'coin height', c.height, 'value', c.value);
  let funds = coins.reduce((v, coin)=>v+coin.value, 0);
  console.log(s+'total coins', coins.length, 'value', funds);
}

async function wallet_addr_coins_print(addr, s){
  let coins = await node_get_coins(addr);
  coins_print(coins, s);
}

async function mtx_send_create({from, from_key, to, value, change, fee}){
  let mtx = new MTX();
  let send = 10000;
  let coins = await node_get_coins(from);
  wallet_addr_coins_print(from, 'wallet from: ');
  wallet_addr_coins_print(to, 'wallet to: ');
  mtx.addOutput({address: to, value});
  change ||= from;
  mtx_fund(mtx, {coins, fee, change});
  mtx.sign(from_key);
  assert(mtx.verify());
  let tx = mtx.toTX();
  assert(tx.verify(mtx.view));
  return mtx;
}

async function do_tx(){
  await do_start();
  return;
  let mtx = await mtx_send_create({from: wallet1.a, from_key: wallet1.keyRing,
    to: wallet2.a, value: 10000, fee: 1000});
  let tx = mtx.toTX();
  assert(tx.verify(mtx.view));
  let res = await node.sendTX(tx);
  await mineBlocks(1);
}

async function main(){
  await do_start();
  if (mine)
    await do_mine();
}
if (!process.browser)
  do_tx();
  //main();
module.exports = {do_start, do_mine, do_tx};
