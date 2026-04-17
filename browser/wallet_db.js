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

export const DEFAULT_NETWORKS = {
  mainnet: {
    name: 'Bitcoin Mainnet',
    symbol: 'BTC',
    network: bitcoin.networks.bitcoin,
    //electrum: 'wss://electrumx.nimiq.com:443/electrumx', // restricted from localhost:5000
    electrum: 'wss://bitcoinserver.nl:50004', // unrestricted
    // electrum: 'wss://electrum.blockstream.info:700', // does not work
    explorer_tx: 'https://mempool.space/tx/',
    coin_type: 0,
    fee_def: 1000, // 1MB = 0.01BTC
  },
  testnet: {
    name: 'Bitcoin Testnet',
    symbol: 'tBTC',
    network: bitcoin.networks.testnet,
    electrum: 'wss://electrum.blockstream.info:993',
    explorer_tx: 'https://mempool.space/testnet/tx/',
    coin_type: 1,
    fee_def: 1000,
  },
  lif: {
    name: 'Lif Mainnet', // Life Chai
    symbol: 'LIF',
    network: networks_lif,
    electrum: 'ws://localhost:8432',
    explorer_tx: 'http://localhost:5000/tx/',
    coin_type: 1842,
    fee_def: 5000000, // 1MB = 50LIF
    fee_max: 10000000,
  },
};
function networks_init(){
  for (let [name, net] of Object.entries(DEFAULT_NETWORKS))
    net.network.conf = net;
}
networks_init();

function Electrum_connect(url){
  let u = URL.parse(url);
  let protocol = u.protocol.slice(0, -1);
  let port = u.port || (protocol=='wss' ? '443' : protocol=='ws' ? '80' : '');
  return new ElectrumClient(u.hostname, port+u.pathname, protocol);
}

const clients = {};
function getClient(conf){
  const url = conf.electrum;
  if (clients[url])
    return clients[url];
  return clients[url] = (async()=>{
    try {
      const cl = Electrum_connect(url);
      await cl.connect('lif-coin-wallet', '1.4');
      return cl;
    } catch(e){
      delete clients[url];
      throw e;
    }
  })();
}

export function getNetworks(servers){
  const result = {};
  for (const net in DEFAULT_NETWORKS){
    result[net] = {...DEFAULT_NETWORKS[net]};
    if (servers[net])
      result[net].electrum = servers[net];
  }
  return result;
}

export function getRoot(mnemonic, network, passphrase=''){
  return bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase), network);
}

export function defaultDerivPath(conf){
  return `m/84'/${conf.coin_type}'/0'`;
}

export function deriveAddrAt(root, accountPath, network, chain, index){
  const child = root.derivePath(`${accountPath}/${chain}/${index}`);
  const pubkey = child.publicKey;
  const {address} = bitcoin.payments.p2wpkh({pubkey, network});
  const keyPair = ecpair.fromPrivateKey(child.privateKey, {network});
  return {address, keyPair, chain, index};
}

export function deriveWallet(mnemonic, networkKey, networks, passphrase='',
  derivPath=null)
{
  const conf = networks[networkKey];
  const network = conf.network;
  const root = getRoot(mnemonic, network, passphrase);
  const accountPath = derivPath || defaultDerivPath(conf);
  const {address, keyPair} = deriveAddrAt(root, accountPath, network, 0, 0);
  return {address, keyPair, network, conf, root};
}

// Scan used addresses on chain (0=external, 1=change) with gap limit of 20.
// Returns {used: [{address, keyPair, chain, index, hist}], nextIndex}
export async function scanAddresses(conf, root, accountPath, chain){
  const network = conf.network;
  const cl = await getClient(conf);
  const GAP = 20;
  const used = [];
  let lastUsed = -1;
  let start = 0;
  while (true){
    const entries = Array.from({length: GAP}, (_, i)=>deriveAddrAt(root,
      accountPath, network, chain, start+i));
    const hists = await Promise.all(
      entries.map(e=>cl.blockchain_scripthash_getHistory(
        getScriptHash(e.address, network)))
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

export function getScriptHash(addr, network){
  const script = bitcoin.address.toOutputScript(addr, network);
  const hash = bitcoin.crypto.sha256(script);
  return Buffer.from(hash.reverse()).toString('hex');
}

const WALLET_STORED_FIELDS = ['id', 'name', 'network', 'mnemonic',
  'passphrase', 'derivPath'];

// id → single wallet object instance (mutated in place)
const walletStore = {};

export function loadWallets(networks){
  try {
    const raw = JSON.parse(localStorage.getItem('wallets')||'[]');
    return raw.map(w=>{
      const conf = networks[w.network]||Object.values(networks)[0];
      if (walletStore[w.id]){
        walletStore[w.id].conf = conf;
        return walletStore[w.id];
      }
      const wallet = {...w, conf};
      walletStore[w.id] = wallet;
      return wallet;
    });
  } catch { return []; }
}

export function saveWallets(wallets){
  const raw = wallets.map(w=>{
    const o = {};
    for (const f of WALLET_STORED_FIELDS){
      if (w[f]!==undefined)
        o[f] = w[f];
    }
    return o;
  });
  localStorage.setItem('wallets', JSON.stringify(raw));
}

export function loadServers(){
  try {
    return JSON.parse(localStorage.getItem('electrum_servers') || '{}');
  } catch { return {}; }
}

export function saveServers(servers){
  localStorage.setItem('electrum_servers', JSON.stringify(servers));
}

// IndexedDB Cache
const db = await openDB('bright-wallet', 1, {
  upgrade(db){
    db.createObjectStore('cache');
  }
});
export async function dbGet(id){
  try {
    return await db.get('cache', id) ?? null;
  } catch{ return null; }
}
export async function dbPut(id, data){
  try {
    await db.put('cache', data, id);
  } catch{}
}

// Populate wallet with cached data from IndexedDB (re-derives keyPairs from
// mnemonic). Idempotent: does nothing if wallet already has
// data (wallet.addrs defined).
async function loadWalletCache(wallet){
  if (wallet.addrs)
    return;
  const cached = await dbGet('walletData:'+wallet.id);
  if (!cached)
    return;
  try {
    const {conf} = wallet;
    const root = getRoot(wallet.mnemonic, conf.network, wallet.passphrase||'');
    const ap = wallet.derivPath||defaultDerivPath(conf);
    const addrs = (cached.addrs||[]).map(a=>({...a, ...deriveAddrAt(root, ap,
      conf.network, a.chain, a.index)}));
    const changeAddrInfo = cached.changeAddrInfo
      ? {...cached.changeAddrInfo, ...deriveAddrAt(root, ap, conf.network,
        cached.changeAddrInfo.chain, cached.changeAddrInfo.index)}
      : null;
    const utxos = (cached.utxos||[]).map(u=>({
      ...u, addrInfo: addrs.find(a=>a.address==u.address)||deriveAddrAt(root,
        ap, conf.network, u.chain, u.index)
    }));
    Object.assign(wallet, {...cached, addrs, changeAddrInfo, utxos});
  } catch(e){}
}

function serializeWallet(wallet){
  return {
    balance: wallet.balance,
    receiveAddress: wallet.receiveAddress,
    feeRate: wallet.feeRate,
    addrs: (wallet.addrs||[]).map(({address, chain, index, hist})=>(
      {address, chain, index, hist})),
    changeAddrInfo: wallet.changeAddrInfo
      ? {address: wallet.changeAddrInfo.address,
        chain: wallet.changeAddrInfo.chain, index: wallet.changeAddrInfo.index}
      : null,
    utxos: (wallet.utxos||[]).map(
      ({tx_hash, tx_pos, value, address, chain, index})=>
        ({tx_hash, tx_pos, value, address, chain, index})),
    transactions: wallet.transactions||[],
    ownedKeys: wallet.ownedKeys||[],
  };
}

// Preload all wallets from IndexedDB into memory at module startup
async function cache_preload(){
  const _networks = getNetworks(loadServers());
  for (const w of loadWallets(_networks))
    await loadWalletCache(w);
}
await cache_preload();

export async function fetchWalletData(wallet){
  const conf = wallet.conf;
  const network = conf.network;
  const cl = await getClient(conf);
  const root = getRoot(wallet.mnemonic, network, wallet.passphrase||'');
  const ap = wallet.derivPath||defaultDerivPath(conf);
  const [extRes, chgRes] = await Promise.all([
    scanAddresses(conf, root, ap, 0),
    scanAddresses(conf, root, ap, 1),
  ]);
  const addrs = [...extRes.used, ...chgRes.used];
  const receiveAddress = deriveAddrAt(root, ap, network, 0, extRes.nextIndex)
    .address;
  const changeAddrInfo = deriveAddrAt(root, ap, network, 1, chgRes.nextIndex);
  const walletAddrSet = new Set(addrs.map(a=>a.address));
  const [utxoLists, bals] = await Promise.all([
    Promise.all(addrs.map(async(a)=>{
      const sh = getScriptHash(a.address, network);
      return (await cl.blockchain_scripthash_listunspent(sh)).map(
        u=>({...u, address: a.address, chain: a.chain, index: a.index}));
    })),
    Promise.all(addrs.map(a=>cl.blockchain_scripthash_getBalance(
      getScriptHash(a.address, network)))),
  ]);
  const utxos = utxoLists.flat().map(u=>({...u, addrInfo: addrs.find(
    a=>a.address==u.address)}));
  const balance = bals.reduce((s, b)=>s+b.confirmed+b.unconfirmed, 0);
  const feeRate = await estimateFee(conf);
  // Transactions
  const txByHash = new Map();
  for (const a of addrs){
    for (const tx of (a.hist||[]))
      txByHash.set(tx.tx_hash, tx);
  }
  const hist = [...txByHash.values()].sort((a, b)=>(b.height||1e9)
    -(a.height||1e9));
  let transactions = [], ownedKeys=[];
  if (hist.length){
    const heights = [...new Set(hist.filter(t=>t.height>0).map(t=>t.height))];
    const [verboseTxs, ...headers] = await Promise.all([
      Promise.all(hist.map(t=>cl.blockchain_transaction_get(t.tx_hash, true))),
      ...heights.map(h=>cl.blockchain_block_header(h)),
    ]);
    const tsMap = {};
    heights.forEach((h, i)=>{
      tsMap[h] = Buffer.from(headers[i], 'hex').readUInt32LE(68);
    });
    const histTxIds = new Set(hist.map(t=>t.tx_hash));
    const prevIds = [...new Set(verboseTxs.flatMap(vtx=>(vtx.vin||[]).map(
      vin=>vin.txid).filter(id=>id&&!histTxIds.has(id))))];
    const prevList = await Promise.all(prevIds.map(
      id=>cl.blockchain_transaction_get(id, true)));
    const prevMap = {};
    prevIds.forEach((id, i)=>{ prevMap[id]=prevList[i]; });
    verboseTxs.forEach(vtx=>{ prevMap[vtx.txid]=vtx; });
    const voutToOurAmt=(vouts)=>(vouts||[]).reduce((sum, vout)=>{
      const as = vout.scriptPubKey?.addresses||(vout.scriptPubKey?.address ?
        [vout.scriptPubKey.address]:[]);
      return as.some(a=>walletAddrSet.has(a)) ? sum+Math.round(vout.value*1e8)
        : sum;
    }, 0);
    transactions = hist.map((tx, i)=>{
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
        return as.some(a=>walletAddrSet.has(a)) ?
          sum+Math.round(vin._prevVout.value*1e8) : sum;
      }, 0);
      return {...tx, timestamp: tx.height>0 ? tsMap[tx.height] : null,
        amount: received-spent, _vtx:{...vtx, vin: enrichedVin}};
    });
    const keyMap = new Map();
    for (const etx of transactions){
      const vouts = etx._vtx?.vout||[];
      for (let i=0; i<vouts.length; i++){
        const vout = vouts[i];
        if (!vout.lif_kv)
          continue;
        const addr = vout.scriptPubKey?.address ||
          vout.scriptPubKey?.addresses?.[0];
        if (!walletAddrSet.has(addr))
          continue;
        for (const kv of vout.lif_kv){
          const isUnconfirmed = etx.height<=0;
          const priority = isUnconfirmed ? Infinity : etx.height;
          const existing = keyMap.get(kv.key);
          if (!existing||priority>=existing._priority){
            const _kstatus = vout.spent ? 'spent' : isUnconfirmed ?
              'receiving' : 'confirmed';
            keyMap.set(kv.key, {key: kv.key, val: kv.val, tx: etx.tx_hash,
              vout: i, _kstatus, _priority: priority});
          }
        }
      }
    }
    ownedKeys = [...keyMap.values()];
  }
  Object.assign(wallet, {balance, receiveAddress, feeRate, addrs,
    changeAddrInfo, utxos, transactions, ownedKeys});
  await dbPut('walletData:'+wallet.id, serializeWallet(wallet));
  return wallet;
}

export async function estimateFee(conf){
  const fallback = conf.fee_def;
  try {
    const cl = await getClient(conf);
    const rate = await cl.request('blockchain.estimatefee', [6]);
    if (rate>0)
      return Math.round(rate*1e8);
  } catch(e){}
  return fallback;
}



export function kv_tx_add(wallet, key, val, fee=0, forEst=false){
  const {conf, utxos, changeAddrInfo} = wallet;
  const network = conf.network;
  const allUTXOs = [...(utxos||[])].sort((a,b)=>b.value-a.value);
  if (!allUTXOs.length)
    throw new Error('No funds available');
  if (!fee){
    const u0 = allUTXOs[0];
    fee = calcFee(wallet.feeRate, kv_tx_new_build(network, [u0], {key, val},
      changeAddrInfo.address, u0.value, 1, true));
  }
  const selected = [];
  let total = 0;
  for (const u of allUTXOs){
    selected.push(u);
    total += u.value;
    if (total>=fee) break;
  }
  if (total<fee)
    throw new Error('Insufficient balance to cover fee');
  const tx = kv_tx_new_build(network, selected, {key, val},
    changeAddrInfo.address, total, fee, forEst);
  return {exactFee: fee, tx};
}

function inscriptionScript(key, val){
  return bitcoin.script.compile([
    bitcoin.opcodes.OP_RETURN, Buffer.from('lif'),
    Buffer.from('key'),
    Buffer.from(key),
    Buffer.from('val'),
    Buffer.from(val),
  ]);
}

export function kv_tx_edit(wallet, kv_d, fee=0, forEst=false){
  const {conf, addrs, utxos, changeAddrInfo} = wallet;
  const network = conf.network;
  const nameVout = kv_d._tx._vtx.vout[kv_d.vout];
  const nameValue = Math.round(nameVout.value*1e8);
  const nameAddr = nameVout.scriptPubKey?.address ||
    nameVout.scriptPubKey?.addresses?.[0];
  const nameAddrInfo = addrs.find(a=>a.address==nameAddr);
  if (!nameAddrInfo)
    throw new Error('Name UTXO address not found in wallet');
  const dest = changeAddrInfo.address;
  if (!fee){
    const estInputs = [{txid: kv_d.tx, vout: kv_d.vout, value: nameValue, addr: nameAddr}];
    fee = calcFee(wallet.feeRate, kv_tx_edit_build(network, estInputs, [nameAddrInfo],
      kv_d, dest, nameValue, 0, dest, 1, true));
  }
  const signers = [nameAddrInfo];
  const inputs = [{txid: kv_d.tx, vout: kv_d.vout, value: nameValue, addr: nameAddr}];
  let extraTotal = 0;
  if (nameValue<fee){
    const allUTXOs = (utxos||[]).filter(
      u=>!(u.tx_hash==kv_d.tx && u.tx_pos==kv_d.vout))
      .sort((a,b)=>b.value-a.value);
    for (const u of allUTXOs){
      signers.push(u.addrInfo);
      inputs.push({txid: u.tx_hash, vout: u.tx_pos, value: u.value,
        addr: u.addrInfo.address});
      extraTotal += u.value;
      if (extraTotal>=fee) break;
    }
    if (extraTotal<fee)
      throw new Error('Insufficient balance to cover fees');
  }
  const tx = kv_tx_edit_build(network, inputs, signers, kv_d,
    dest, nameValue, extraTotal, changeAddrInfo.address, fee, forEst);
  return {exactFee: fee, tx};
}

export function kv_tx_send(wallet, kv_d, toAddress, fee=0, forEst=false){
  const {conf, addrs, utxos, changeAddrInfo} = wallet;
  const network = conf.network;
  const nameVout = kv_d._tx._vtx.vout[kv_d.vout];
  const nameValue = Math.round(nameVout.value*1e8);
  const nameAddr = nameVout.scriptPubKey?.address ||
    nameVout.scriptPubKey?.addresses?.[0];
  const nameAddrInfo = addrs.find(a=>a.address==nameAddr);
  if (!nameAddrInfo)
    throw new Error('Name UTXO address not found in wallet');
  if (!fee){
    const estInputs = [{txid: kv_d.tx, vout: kv_d.vout, value: nameValue, addr: nameAddr}];
    fee = calcFee(wallet.feeRate, kv_tx_send_build(network, estInputs, [nameAddrInfo],
      changeAddrInfo.address, nameValue, 0, changeAddrInfo.address, 1, true));
  }
  const signers = [nameAddrInfo];
  const inputs = [{txid: kv_d.tx, vout: kv_d.vout, value: nameValue, addr: nameAddr}];
  let extraTotal = 0;
  if (nameValue<fee){
    const allUTXOs = (utxos||[]).filter(
      u=>!(u.tx_hash==kv_d.tx && u.tx_pos==kv_d.vout))
      .sort((a,b)=>b.value-a.value);
    for (const u of allUTXOs){
      signers.push(u.addrInfo);
      inputs.push({txid: u.tx_hash, vout: u.tx_pos, value: u.value,
        addr: u.addrInfo.address});
      extraTotal += u.value;
      if (extraTotal>=fee) break;
    }
    if (extraTotal<fee)
      throw new Error('Insufficient balance to cover fees');
  }
  const tx = kv_tx_send_build(network, inputs, signers, toAddress, nameValue,
    extraTotal, changeAddrInfo.address, fee, forEst);
  return {exactFee: fee, tx};
}

export function tx_send(wallet, toAddress, amountValue, fee=0){
  const {conf, utxos, changeAddrInfo} = wallet;
  const network = conf.network;
  const allUTXOs = [...(utxos||[])].sort((a,b)=>b.value-a.value);
  if (!allUTXOs.length)
    throw new Error('No funds available');
  if (!fee){
    const u0 = allUTXOs[0];
    fee = calcFee(wallet.feeRate, tx_send_build(network, [u0],
      changeAddrInfo.address, 1, changeAddrInfo.address, u0.value, 1, true));
  }
  const selected = [];
  let total = 0;
  for (const u of allUTXOs){
    selected.push(u);
    total += u.value;
    if (total>=amountValue+fee) break;
  }
  if (total<amountValue+fee)
    throw new Error('Insufficient balance');
  const tx = tx_send_build(network, selected, toAddress, amountValue,
    changeAddrInfo.address, total, fee);
  return {exactFee: fee, tx};
}

export async function tx_broadcast(conf, tx){
  const cl = await getClient(conf);
  let txid = await cl.blockchain_transaction_broadcast(tx.toHex());
  if (txid!=tx.getId())
    console.error(`mistmatch txid ${txid} ${tx.getId()}`);
}

export async function listUnspentForAddr(conf, addr){
  const cl = await getClient(conf);
  return cl.blockchain_scripthash_listunspent(
    getScriptHash(addr, conf.network));
}

export async function kv_get(conf, key){
  const cl = await getClient(conf);
  return cl.request('blockchain.lif_kv.get', [key]);
}

export function calcFee(rateSatPerKb, tx){
  return Math.ceil(rateSatPerKb/1000*tx.virtualSize());
}

export function findAddrInWallet(root, accountPath, network, targetAddr){
  for (let ch=0; ch<2; ch++){
    for (let idx=0; idx<30; idx++){
      const info = deriveAddrAt(root, accountPath, network, ch, idx);
      if (info.address==targetAddr)
        return info;
    }
  }
  return null;
}

// inputs: [{tx_hash, tx_pos, value, addrInfo:{address, keyPair}}]
export function tx_send_build(network, inputs, toAddr, amt, changeAddr, total,
  txFee, forEst=false)
{
  const p = bitcoin_psbt(network);
  for (const u of inputs){
    p.addInput({hash: u.tx_hash, index: u.tx_pos,
      witnessUtxo: {value: BigInt(u.value),
      script: bitcoin.address.toOutputScript(u.addrInfo.address, network)}});
  }
  p.addOutput({address: toAddr, value: BigInt(amt)});
  const ch = total-amt-txFee;
  p.addOutput({address: changeAddr, value: BigInt(ch)});
  for(let i=0; i<inputs.length; i++)
    p.signInput(i, inputs[i].addrInfo.keyPair);
  p.finalizeAllInputs();
  return p.extractTransaction(forEst);
}

function bitcoin_psbt(network){
  const p = new bitcoin.Psbt({network});
  if (network.conf.fee_max)
    p.setMaximumFeeRate(network.conf.fee_max/1000);
  return p;
}
// inputs: [{tx_hash, tx_pos, value, addrInfo:{address, keyPair}}]
export function kv_tx_new_build(network, inputs, {key, val}, changeAddr, total,
  txFee, forEst=false)
{
  const p = bitcoin_psbt(network);
  for (const u of inputs){
    p.addInput({hash: u.tx_hash, index: u.tx_pos,
      witnessUtxo: {value: BigInt(u.value),
      script: bitcoin.address.toOutputScript(u.addrInfo.address, network)}});
  }
  p.addOutput({script: inscriptionScript(key, val), value: 0n});
  p.addOutput({address: changeAddr, value: BigInt(total-txFee)});
  for(let i=0; i<inputs.length; i++)
    p.signInput(i, inputs[i].addrInfo.keyPair);
  p.finalizeAllInputs();
  return p.extractTransaction(forEst);
}

// inputs: [{txid, vout, value, addr}], signers: [{keyPair}]
export function kv_tx_send_build(network, inputs, signers, toAddr, nameValue,
  extraTotal, changeAddr, txFee, forEst=false)
{
  const p = bitcoin_psbt(network);
  for (const inp of inputs){
    p.addInput({hash: inp.txid, index: inp.vout,
      witnessUtxo: {value: BigInt(inp.value),
        script: bitcoin.address.toOutputScript(inp.addr, network)}});
  }
  if (nameValue<txFee){
    p.addOutput({address: toAddr, value: BigInt(nameValue)});
    const ch = extraTotal-txFee;
    p.addOutput({address: changeAddr, value: BigInt(ch)});
  } else
    p.addOutput({address: toAddr, value: BigInt(nameValue-txFee)});
  for(let i=0; i<signers.length; i++)
    p.signInput(i, signers[i].keyPair);
  p.finalizeAllInputs();
  return p.extractTransaction(forEst);
}

// inputs: [{txid, vout, value, addr}], signers: [{keyPair}]
export function kv_tx_edit_build(network, inputs, signers, {key, val}, dest,
  nameValue, extraTotal, changeAddr, txFee, forEst=false)
{
  const p = bitcoin_psbt(network);
  for (const inp of inputs){
    p.addInput({hash: inp.txid, index: inp.vout,
      witnessUtxo: {value: BigInt(inp.value),
        script: bitcoin.address.toOutputScript(inp.addr, network)}});
  }
  p.addOutput({script: inscriptionScript(key, val), value: 0n});
  if (nameValue<txFee){
    p.addOutput({address: dest, value: BigInt(nameValue)});
    const ch = extraTotal-txFee;
    p.addOutput({address: changeAddr, value: BigInt(ch)});
  } else
    p.addOutput({address: dest, value: BigInt(nameValue-txFee)});
  for(let i=0; i<signers.length; i++)
    p.signInput(i, signers[i].keyPair);
  p.finalizeAllInputs();
  return p.extractTransaction(forEst);
}

