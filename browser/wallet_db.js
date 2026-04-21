// wallet_db.js - bright wallet database and network
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import ecc from '@bitcoinerlab/secp256k1';
import {BIP32Factory} from 'bip32';
const bip32 = BIP32Factory(ecc);
import {ECPairFactory} from 'ecpair';
const ecpair = ECPairFactory(ecc);
import ElectrumClient from '@aguycalled/electrum-client-js';
import {openDB} from 'idb';

// from lif-kernel/util.js
// throw Error -> undefined
export function T(fn, throw_val){
  try {
    return fn();
  } catch(err){ return throw_val; }
}
export const OE = o=>o ? Object.entries(o) : [];
export const OV = o=>o ? Object.values(o) : [];
export const OA = Object.assign;
export const ewait = ()=>{
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
export const esleep = ms=>{
  let p = ewait();
  setTimeout(()=>p.return(), ms);
  return p;
};

// add Lif network, from lif-coin/lib/protocol/networks.js
let networks_lif = {
  bech32: 'lif',
  bip32: {
    public: 0x019da4e0,
    private: 0x019da380,
  },
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
  messagePrefix: '\x18Bitcoin Signed Message:\n',
};

export const nets_list = {
  lif: {
    name: 'Lifcoin', // Life Chai
    symbol: 'LIF',
    network: networks_lif,
    electrum: 'ws://localhost:8432',
    explorer_tx: 'http://localhost:5000/tx/',
    coin_type: 1842,
    fee_def: 5000000, // 1MB = 50LIF
    fee_max: 10000000,
    lif_kv: true,
  },
  btc: {
    name: 'Bitcoin',
    symbol: 'BTC',
    network: bitcoin.networks.bitcoin,
    //electrum: 'wss://electrumx.nimiq.com:443/electrumx', // restricted from localhost:5000
    electrum: 'wss://bitcoinserver.nl:50004', // unrestricted
    // electrum: 'wss://electrum.blockstream.info:700', // does not work
    explorer_tx: 'https://mempool.space/tx/',
    coin_type: 0,
    fee_def: 1000, // 1MB = 0.01BTC
  },
  btc_testnet: {
    name: 'Bitcoin Testnet',
    symbol: 'tBTC',
    network: bitcoin.networks.testnet,
    electrum: 'wss://electrum.blockstream.info:993',
    explorer_tx: 'https://mempool.space/testnet/tx/',
    coin_type: 1,
    fee_def: 1000,
    test: true,
  },
};
function networks_init(){
  for (let [name, net] of OE(nets_list))
    net.network.conf = net;
}
networks_init();

const HD_SCAN_GAP = 20;
const DUST_VAL = 1;

function Electrum_connect(url){
  let u = URL.parse(url);
  let protocol = u.protocol.slice(0, -1);
  let port = u.port || (protocol=='wss' ? '443' : protocol=='ws' ? '80' : '');
  return new ElectrumClient(u.hostname, port+u.pathname, protocol);
}

const clients = {};
function el_connect(conf){
  const url = conf.electrum;
  if (clients[url])
    return clients[url];
  return clients[url] = (async()=>{
    try {
      const el = Electrum_connect(url);
      await el.connect('lif-coin-wallet', '1.4');
      return el;
    } catch(e){
      delete clients[url];
      throw e;
    }
  })();
}

export function nets_get(servers){
  const result = {};
  for (const net in nets_list){
    result[net] = {...nets_list[net]};
    if (servers[net])
      result[net].electrum = servers[net];
  }
  return result;
}

export function hd_root(mnemonic, network, passphrase=''){
  return bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase), network);
}
function wallet_root(wallet){
  const {ls, c, conf} = wallet;
  if (c.root)
    return c.root;
  return c.root = hd_root(ls.mnemonic, conf.network, ls.passphrase||'');
}

export function hd_path_def(conf){
  return `m/84'/${conf.coin_type}'/0'`;
}

export function hd_addr(root, accountPath, network, chain, index){
  const child = root.derivePath(`${accountPath}/${chain}/${index}`);
  const pubkey = child.publicKey;
  const {address} = bitcoin.payments.p2wpkh({pubkey, network});
  const keyPair = ecpair.fromPrivateKey(child.privateKey, {network});
  return {address, keyPair, chain, index};
}

export function hd_wallet(mnemonic, networkKey, networks, passphrase='',
  derivPath=null)
{
  const conf = networks[networkKey];
  const network = conf.network;
  const root = hd_root(mnemonic, network, passphrase);
  const accountPath = derivPath || hd_path_def(conf);
  const {address, keyPair} = hd_addr(root, accountPath, network, 0, 0);
  return {address, keyPair, network, conf, root};
}

// Scan used addresses on chain (0=external, 1=change) with gap limit of 20.
// Returns {used: [{address, keyPair, chain, index, hist}], nextIndex}
export async function hd_scan(conf, root, accountPath, chain){
  const network = conf.network;
  const el = await el_connect(conf);
  const GAP = HD_SCAN_GAP;
  const used = [];
  let lastUsed = -1;
  let start = 0;
  while (true){
    const entries = Array.from({length: GAP}, (_, i)=>hd_addr(root,
      accountPath, network, chain, start+i));
    const hists = await Promise.all(
      entries.map(e=>el.blockchain_scripthash_getHistory(
        addr_sh(e.address, network)))
    );
    let anyUsed = false;
    for (let i=0; i<GAP; i++){
      if (hists[i].length>0){
        used.push({...entries[i], hist: hists[i]});
        lastUsed = entries[i].index;
        anyUsed = true;
      }
    }
    if (!anyUsed)
      break;
    start += GAP;
  }
  return {used, nextIndex: lastUsed+1};
}

// convert address to scripthash (electrum usess scripthash for addresses)
export function addr_sh(saddr, network){
  const script = bitcoin.address.toOutputScript(saddr, network);
  const hash = bitcoin.crypto.sha256(script);
  return Buffer.from(hash.reverse()).toString('hex');
}

// id → single wallet object instance (mutated in place)
const wallets_store = {};

export function wallets_load(){
  let networks = nets_get(servers_load());
  for (let id in wallets_store)
    _wallet_del(id);
  let wallets_ls = T(()=>JSON.parse(localStorage.getItem('wallets'))) || {};
  for (const [id, ls] of OE(wallets_ls)){
    if (ls.id!=id){
      console.error(`invalid wallet id ${ls.id} ${id}`);
      ls.id = id;
    }
    _wallet_add(ls);
  }
  return wallets_store;
}

export function wallets_get(){
  return wallets_store;
}

export function wallets_save(){
  const wallets_ls = {};
  for (const [id, w] of OE(wallets_store))
    wallets_ls[id] = w.ls;
  localStorage.setItem('wallets', JSON.stringify(wallets_ls));
}

export function wallet_get(id){
  return wallets_store[id];
}

function _wallet_add(w_ls){
  let networks = nets_get(servers_load());
  let wallet = {
    ls: {...w_ls},
    c: {},
    cs: {},
    conf: networks[w_ls.network],
  };
  wallet.network = wallet.conf.network;
  wallet.ls.name ||= '';
  wallets_store[wallet.ls.id] = wallet;
}

export function wallet_add(w_ls){
  _wallet_add(w_ls);
  wallets_save();
}

export function wallet_update(id){
  wallets_save();
}

function _wallet_del(id){
  delete wallets_store[id];
}

export function wallet_del(id){
  _wallet_del(id);
  wallets_save();
}

export function servers_load(){
  return T(()=>JSON.parse(localStorage.getItem('electrum_servers'))) || {};
}

export function servers_save(servers){
  localStorage.setItem('electrum_servers', JSON.stringify(servers));
}

// IndexedDB Cache
let db;
async function db_init(){
  db = await openDB('bright-wallet', 1, {
    upgrade(db){
      db.createObjectStore('cache');
    }
  });
}
export async function db_get(id){
  try {
    return await db.get('cache', id) ?? null;
  } catch{ return null; }
}
export async function db_put(id, data){
  try {
    await db.put('cache', data, id);
  } catch{}
}
export async function cache_clear(){
  try { await db.clear('cache'); } catch{}
  for (const w of wallets_store){
    w.c = {};
    w.cs = {};
  }
}

const cache_ver = '2';
// Populate wallet with cached data from IndexedDB (re-derives keyPairs from
// mnemonic). Idempotent: does nothing if wallet already has
// data (wallet.c.addrs defined).
async function wallet_cs_load(wallet){
  const {c, cs, conf, network} = wallet;
  if (cs.addrs)
    return;
  const _cs = await db_get('walletData:'+wallet.ls.id);
  if (!_cs)
    return;
  if (_cs.cache_ver!=cache_ver)
    return console.log(`cache_ver changed ${cs.cache_ver} -> ${cache_ver}`);
  OA(cs, _cs);
  OA(c, _cs);
  const root = wallet_root(wallet);
  const ap = wallet.derivPath || hd_path_def(conf);
  c.addrs = cs.addrs.map(a=>({...a, ...hd_addr(root, ap,
    network, a.chain, a.index)}));
  c.changeAddrInfo = cs.changeAddrInfo
    ? {...cs.changeAddrInfo, ...hd_addr(root, ap, network,
      cs.changeAddrInfo.chain, cs.changeAddrInfo.index)}
    : null;
  c.utxos = cs.utxos.map(u=>({
    ...u, addrInfo: cs.addrs.find(a=>a.address==u.address)||hd_addr(root,
      ap, network, u.chain, u.index)
  }));
}

// Preload all wallets from IndexedDB into memory at module startup
export async function wallet_db_init(){
  await db_init();
  wallets_load();
  for (const w of OV(wallets_store))
    await wallet_cs_load(w);
}

async function _wallet_fetch(wallet){
  const {conf, ls, c, cs} = wallet;
  const network = conf.network;
  const el = await el_connect(conf);
  const root = wallet_root(wallet);
  const ap = ls.derivPath || hd_path_def(conf);
  const [extRes, chgRes] = await Promise.all([
    hd_scan(conf, root, ap, 0),
    hd_scan(conf, root, ap, 1),
  ]);
  const addrs = c.addrs = [...extRes.used, ...chgRes.used];
  cs.addrs = c.addrs.map(({address, chain, index, hist})=>(
    {address, chain, index, hist}));
  c.receiveAddress = hd_addr(root, ap, network, 0, extRes.nextIndex)
    .address;
  cs.receiveAddress = c.receiveAddress;
  c.changeAddrInfo = hd_addr(root, ap, network, 1, chgRes.nextIndex);
  cs.changeAddrInfo = c.changeAddrInfo
    ? {address: c.changeAddrInfo.address,
      chain: c.changeAddrInfo.chain, index: c.changeAddrInfo.index}
    : null;
  const addr_set = new Set(addrs.map(a=>a.address));
  const [utxo_list, bals] = await Promise.all([
    Promise.all(addrs.map(async(a)=>{
      const sh = addr_sh(a.address, network);
      const unspent = await el.blockchain_scripthash_listunspent(sh);
      return unspent.map(u=>({...u, address: a.address, chain: a.chain, index: a.index}));
    })),
    Promise.all(addrs.map(async(a)=>{
      let bal = await el.blockchain_scripthash_getBalance(
        addr_sh(a.address, network));
      return bal;
    })),
  ]);
  c.utxos = utxo_list.flat().map(u=>({...u, addrInfo: addrs.find(
    a=>a.address==u.address)}));
  cs.utxos = c.utxos.map(({tx_hash, tx_pos, value, address, chain, index})=>
    ({tx_hash, tx_pos, value, address, chain, index}));
  c.balance = bals.reduce((s, b)=>s+b.confirmed+b.unconfirmed, 0);
  cs.balance = c.balance;
  c.feeRate = await el_estimatefee(conf);
  cs.feeRate = c.feeRate;
  // Transactions
  const txByHash = new Map();
  for (const a of addrs){
    for (const tx of (a.hist||[]))
      txByHash.set(tx.tx_hash, tx);
  }
  const hist = [...txByHash.values()].sort((a, b)=>(b.height||1e9)
    -(a.height||1e9));
  c.transactions = [];
  c.ownedKeys = [];
  if (hist.length){
    const heights = [...new Set(hist.filter(t=>t.height>0).map(t=>t.height))];
    const [verboseTxs, ...headers] = await Promise.all([
      Promise.all(hist.map(t=>el.blockchain_transaction_get(t.tx_hash, true))),
      ...heights.map(h=>el.blockchain_block_header(h)),
    ]);
    const tsMap = {};
    heights.forEach((h, i)=>{
      tsMap[h] = Buffer.from(headers[i], 'hex').readUInt32LE(68);
    });
    const histTxIds = new Set(hist.map(t=>t.tx_hash));
    const prevIds = [...new Set(verboseTxs.flatMap(vtx=>(vtx.vin||[]).map(
      vin=>vin.txid).filter(id=>id&&!histTxIds.has(id))))];
    const prevList = await Promise.all(prevIds.map(
      id=>el.blockchain_transaction_get(id, true)));
    const prevMap = {};
    prevIds.forEach((id, i)=>{ prevMap[id]=prevList[i]; });
    verboseTxs.forEach(vtx=>{ prevMap[vtx.txid]=vtx; });
    const voutToOurAmt=(vouts)=>(vouts||[]).reduce((sum, vout)=>{
      const as = vout.scriptPubKey?.addresses||(vout.scriptPubKey?.address ?
        [vout.scriptPubKey.address]:[]);
      return as.some(a=>addr_set.has(a)) ? sum+Math.round(vout.value*1e8)
        : sum;
    }, 0);
    c.transactions = hist.map((tx, i)=>{
      const vtx = verboseTxs[i];
      const enrichedVin = (vtx.vin||[]).map(vin=>{
        if (!vin.txid)
          return vin;
        return {...vin, _prevVout: prevMap[vin.txid]?.vout?.[vin.vout]};
      });
      const received = voutToOurAmt(vtx.vout);
      const spent = enrichedVin.reduce((sum, vin)=>{
        if (!vin._prevVout)
          return sum;
        const as = vin._prevVout.scriptPubKey?.addresses ||
          (vin._prevVout.scriptPubKey?.address ?
          [vin._prevVout.scriptPubKey.address] : []);
        return as.some(a=>addr_set.has(a)) ?
          sum+Math.round(vin._prevVout.value*1e8) : sum;
      }, 0);
      return {...tx, timestamp: tx.height>0 ? tsMap[tx.height] : null,
        amount: received-spent, _vtx:{...vtx, vin: enrichedVin}};
    });
    if (conf.lif_kv){
      const keyMap = new Map();
      for (const etx of c.transactions){
        const vouts = etx._vtx?.vout||[];
        for (let i=0; i<vouts.length; i++){
          const vout = vouts[i];
          if (!vout.lif_kv)
            continue;
          const saddr = vout.scriptPubKey?.address ||
            vout.scriptPubKey?.addresses?.[0];
          if (!addr_set.has(saddr))
            continue;
          for (const kv of vout.lif_kv){
            const isUnconfirmed = etx.height<=0;
            const priority = isUnconfirmed ? Infinity : etx.height;
            const existing = keyMap.get(kv.key);
            if (!existing || priority>=existing._priority){
              const _kstatus = vout.spent ? 'spent' : isUnconfirmed ?
                'receiving' : 'confirmed';
              keyMap.set(kv.key, {key: kv.key, val: kv.val, tx: etx.tx_hash,
                vout: i, _kstatus, _priority: priority});
            }
          }
        }
      }
      c.ownedKeys = [...keyMap.values()];
    }
  }
  cs.transactions = c.transactions;
  cs.ownedKeys = c.ownedKeys;
  cs.cache_ver = cache_ver;
  await db_put('walletData:'+ls.id, cs);
  return wallet;
}

export async function wallet_fetch(wallet, force){
  let wait;
  if (!force && (wait = wallet.c_wait))
    return await wait;
  wait = wallet.c_wait = ewait();
  return wait.return(await _wallet_fetch(wallet));
}

export async function el_estimatefee(conf){
  const fallback = conf.fee_def;
  try {
    const el = await el_connect(conf);
    const rate = await el.request('blockchain.estimatefee', [6]);
    if (rate>0)
      return Math.round(rate*1e8);
  } catch(e){}
  return fallback;
}

function kv_script(key, val){
  return bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN, Buffer.from('lif'),
    Buffer.from('key'),
    Buffer.from(key),
    Buffer.from('val'),
    Buffer.from(val),
  ]);
}

export async function tx_broadcast(conf, tx){
  const el = await el_connect(conf);
  let txid = await el.blockchain_transaction_broadcast(tx.toHex());
  if (txid!=tx.getId())
    console.error(`mistmatch txid ${txid} ${tx.getId()}`);
}

export async function el_list_unspent(conf, saddr){
  const el = await el_connect(conf);
  return el.blockchain_scripthash_listunspent(
    addr_sh(saddr, conf.network));
}

export async function kv_get(conf, key){
  const el = await el_connect(conf);
  return el.request('blockchain.lif_kv.get', [key]);
}

export function fee_calc(rateSatPerKb, tx){
  return Math.ceil(rateSatPerKb/1000*tx.virtualSize());
}

export function hd_addr_find(root, accountPath, network, saddr_find){
  for (let ch=0; ch<2; ch++){
    for (let idx=0; idx<30; idx++){
      const info = hd_addr(root, accountPath, network, ch, idx);
      if (info.address==saddr_find)
        return info;
    }
  }
}

function tx_psbt(network){
  const p = new bitcoin.Psbt({network});
  if (network.conf.fee_max)
    p.setMaximumFeeRate(network.conf.fee_max/1000);
  return p;
}

function psbt_input_get_value(psbt, vin){
  const in_data = psbt.data.inputs[vin];
  // Most common case: Native SegWit / Taproot
  if (in_data.witnessUtxo)
    return in_data.witnessUtxo.value;
  // Legacy / Nested SegWit case
  if (in_data.nonWitnessUtxo){
    const prevTx = bitcoin.Transaction.fromBuffer(in_data.nonWitnessUtxo);
    const outputIndex = psbt.txInputs[vin].index;
    return prevTx.outs[outputIndex].value;
  }
  // No value information available
  throw new Error(`Input ${vin} missing value info (witnessUtxo or nonWitnessUtxo)`);
}

function tx_fund(wallet, p, in_sign, fee){
  const {c, conf, network} = wallet;
  const _sum_out = Number(
    p.txOutputs.reduce((sum, output)=>sum+output.value, 0n));
  const needed = _sum_out+fee;
  let sum_in = 0;
  for (let i=0; i<p.inputCount; i++)
    sum_in += Number(psbt_input_get_value(p, i));
  if (conf.fee_max)
    p.setMaximumFeeRate(conf.fee_max/1000);
  const sum_out = _sum_out+fee;
  // sort from big to small
  // filter out 0 value (which are probably lif kv coins) and
  // and dust coins.
  const utxos = [...c.utxos].sort((a,b)=>b.value-a.value)
  .filter(u=>u.value>DUST_VAL);
  in_sign = [...in_sign];
  const selected = [];
  if (sum_in>=sum_out)
    ; // no need funding
  else if (!utxos.length)
    return {err: "no funds"};
  else if (utxos[0].value>=sum_out-sum_in){
    // single coin funding: find smallest single coin that is still enough
    let coin = utxos[0];
    for (const u of utxos){
      if (u.value<sum_out-sum_in)
        break;
      coin = u;
    }
    selected.push(coin);
    sum_in += Number(coin.value);
  } else {
    // fund with multiple coins
    for (const u of utxos){
      selected.push(u);
      sum_in += Number(u.value);
      if (sum_in>=sum_out)
        break;
    }
  }
  for (const u of selected){
    p.addInput({hash: u.tx_hash, index: u.tx_pos,
      witnessUtxo: {value: BigInt(u.value),
      script: bitcoin.address.toOutputScript(u.addrInfo.address, network)}});
    in_sign.push(u);
  }
  if (sum_in<sum_out)
    return {err: "insufficient funds"};
  if (sum_in-sum_out>DUST_VAL){
    let chg = sum_in-sum_out; // add output to change
    p.addOutput({address: c.changeAddrInfo.address, value: BigInt(chg)});
  }
  for(let i=0; i<in_sign.length; i++)
    p.signInput(i, in_sign[i].addrInfo.keyPair);
  p.finalizeAllInputs();
  const tx = p.extractTransaction();
  return {utxos: in_sign, tx, pstb: p, fee, _fee: sum_in-sum_out};
}

/*
function tx_fee_calc(wallet, tx_fn){
  let ret = tx_fn();
  if (ret.err)
    return ret;
  let fee = fee_calc(wallet.c.feeRate, ret.tx);
    if (ret.err)
      return ret;
    fee = ret.fee;
}*/

function _tx_send({wallet, saddr_to, value, fee}){
  const {network} = wallet;
  const p = tx_psbt(network);
  p.addOutput({address: saddr_to, value: BigInt(value)});
  return tx_fund(wallet, p, [], fee);
}

export function tx_send(wallet, saddr_to, value, fee){
  const {c} = wallet;
  if (!fee){
    let tx = _tx_send({wallet, saddr_to, value, fee: 1});
    if (tx.err)
      return tx;
    fee = fee_calc(c.feeRate, tx.tx);
  }
  return _tx_send({wallet, saddr_to, value, fee});
}

export function kv_tx_add(wallet, key, val, fee){
  const {c, network} = wallet;
  if (!fee)
    fee = fee_calc(c.feeRate, kv_tx_add(wallet, key, val, 1).tx);
  const p = tx_psbt(network);
  p.addOutput({script: kv_script(key, val), value: 0n});
  p.addOutput({address: c.changeAddrInfo.address, value: 1n});
  // XXX dont reuse same changeAddrInfo for change - inc next change addr
  return tx_fund(wallet, p, [], fee);
}

export function kv_tx_send(wallet, kv_d, saddr_to, fee){
  const {c, network} = wallet;
  if (!fee)
    fee = fee_calc(c.feeRate, kv_tx_send(wallet, kv_d, saddr_to, 1).tx);
  const p = tx_psbt(network);
  const vout = kv_d._tx._vtx.vout[kv_d.vout];
  const value = Math.round(vout.value*1e8);
  const saddr = vout.scriptPubKey?.address ||
    vout.scriptPubKey?.addresses?.[0];
  const addr = c.addrs.find(a=>a.address==saddr);
  if (!addr)
    throw new Error('Name UTXO address of KV not found in wallet');
  const in_sign = [];
  p.addInput({hash: kv_d.tx, index: kv_d.vout,
    witnessUtxo: {value: BigInt(value),
      script: bitcoin.address.toOutputScript(saddr, network)}});
  in_sign.push({addrInfo: addr});
  p.addOutput({address: saddr_to, value: 1n});
  return tx_fund(wallet, p, in_sign, fee, c.changeAddrInfo.address);
}

export function kv_tx_edit(wallet, kv_d, fee){
  const {c, network} = wallet;
  if (!fee)
    fee = fee_calc(c.feeRate, kv_tx_edit(wallet, kv_d, 1).tx);
  const p = tx_psbt(network);
  const vout = kv_d._tx._vtx.vout[kv_d.vout];
  const value = Math.round(vout.value*1e8);
  const saddr = vout.scriptPubKey?.address ||
    vout.scriptPubKey?.addresses?.[0];
  const addr = c.addrs.find(a=>a.address==saddr);
  if (!addr)
    throw new Error('Name UTXO address of KV not found in wallet');
  const in_sign = [];
  p.addInput({hash: kv_d.tx, index: kv_d.vout,
    witnessUtxo: {value: BigInt(value),
      script: bitcoin.address.toOutputScript(saddr, network)}});
  in_sign.push({addrInfo: addr});
  p.addOutput({script: kv_script(kv_d.key, kv_d.val), value: 0n});
  p.addOutput({address: c.changeAddrInfo.address, value: 1n});
  return tx_fund(wallet, p, in_sign, fee, c.changeAddrInfo.address);
}

