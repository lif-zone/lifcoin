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
  },
};

export function Electrum_connect(url){
  let u = URL.parse(url);
  let protocol = u.protocol.slice(0, -1);
  let port = u.port || (protocol=='wss' ? '443' : protocol=='ws' ? '80' : '');
  return new ElectrumClient(u.hostname, port+u.pathname, protocol);
}

export function getNetworks(servers){
  const result = {};
  for (const key in DEFAULT_NETWORKS){
    result[key] = {...DEFAULT_NETWORKS[key]};
    if (servers[key])
      result[key].electrum = servers[key];
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

export function deriveWallet(mnemonic, networkKey, networks, passphrase='', derivPath=null){
  const conf = networks[networkKey];
  const network = conf.network;
  const root = getRoot(mnemonic, network, passphrase);
  const accountPath = derivPath || defaultDerivPath(conf);
  const {address, keyPair} = deriveAddrAt(root, accountPath, network, 0, 0);
  return {address, keyPair, network, conf, root};
}

// Scan used addresses on chain (0=external, 1=change) with gap limit of 20.
// Returns {used: [{address, keyPair, chain, index, hist}], nextIndex}
export async function scanAddresses(cl, root, accountPath, network, chain){
  const GAP = 20;
  const used = [];
  let lastUsed = -1;
  let start = 0;
  while (true){
    const entries = Array.from({length: GAP}, (_, i)=>deriveAddrAt(root, accountPath, network, chain, start+i));
    const hists = await Promise.all(
      entries.map(e=>cl.blockchain_scripthash_getHistory(getScriptHash(e.address, network)))
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

export function loadWallets(){
  try {
    const saved = localStorage.getItem('wallets');
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export function saveWallets(wallets){
  localStorage.setItem('wallets', JSON.stringify(wallets));
}

export function loadServers(){
  try { return JSON.parse(localStorage.getItem('electrum_servers') || '{}'); }
  catch { return {}; }
}

export function saveServers(servers){
  localStorage.setItem('electrum_servers', JSON.stringify(servers));
}

// IndexedDB Cache
const db = await openDB('bright-wallet', 1, {
  upgrade(db){ db.createObjectStore('cache'); }
});
export async function dbGet(id){
  try { return await db.get('cache', id) ?? null; } catch{ return null; }
}
export async function dbPut(id, data){
  try { await db.put('cache', data, id); } catch{}
}

// In-memory wallet data store
const store = { data: {} };

function hydrateWalletData(wallet, conf, cached){
  try {
    const root=getRoot(wallet.mnemonic,conf.network,wallet.passphrase||'');
    const ap=wallet.derivPath||defaultDerivPath(conf);
    const addrs=(cached.addrs||[]).map(a=>({...a,...deriveAddrAt(root,ap,conf.network,a.chain,a.index)}));
    const changeAddrInfo=cached.changeAddrInfo
      ?{...cached.changeAddrInfo,...deriveAddrAt(root,ap,conf.network,cached.changeAddrInfo.chain,cached.changeAddrInfo.index)}
      :null;
    const utxos=(cached.utxos||[]).map(u=>({
      ...u,addrInfo:addrs.find(a=>a.address==u.address)||deriveAddrAt(root,ap,conf.network,u.chain,u.index)
    }));
    return {...cached,addrs,changeAddrInfo,utxos};
  } catch(e){ return null; }
}

function serializeWalletData(data){
  return {
    balance: data.balance,
    receiveAddress: data.receiveAddress,
    feeRate: data.feeRate,
    addrs: (data.addrs||[]).map(({address,chain,index,hist})=>({address,chain,index,hist})),
    changeAddrInfo: data.changeAddrInfo
      ?{address:data.changeAddrInfo.address,chain:data.changeAddrInfo.chain,index:data.changeAddrInfo.index}
      :null,
    utxos: (data.utxos||[]).map(({tx_hash,tx_pos,value,address,chain,index})=>({tx_hash,tx_pos,value,address,chain,index})),
    transactions: data.transactions||[],
    ownedKeys: data.ownedKeys||[],
  };
}

// Preload all wallets from IndexedDB into memory at module startup
{
  const _wallets=loadWallets(), _servers=loadServers();
  const _networks=getNetworks(_servers);
  for (const w of _wallets){
    const conf=_networks[w.network]||Object.values(_networks)[0];
    const cached=await dbGet('walletData:'+w.id);
    if (cached){
      const hydrated=hydrateWalletData(w,conf,cached);
      if (hydrated) store.data[w.id]=hydrated;
    }
  }
}

export function getWalletData(id){ return store.data[id]||null; }

export async function fetchWalletData(wallet, conf, client){
  const network=conf.network;
  const root=getRoot(wallet.mnemonic,network,wallet.passphrase||'');
  const ap=wallet.derivPath||defaultDerivPath(conf);
  const [extRes,chgRes]=await Promise.all([
    scanAddresses(client,root,ap,network,0),
    scanAddresses(client,root,ap,network,1),
  ]);
  const addrs=[...extRes.used,...chgRes.used];
  const receiveAddress=deriveAddrAt(root,ap,network,0,extRes.nextIndex).address;
  const changeAddrInfo=deriveAddrAt(root,ap,network,1,chgRes.nextIndex);
  const walletAddrSet=new Set(addrs.map(a=>a.address));
  const [utxoLists,bals]=await Promise.all([
    Promise.all(addrs.map(async(a)=>{
      const sh=getScriptHash(a.address,network);
      return (await client.blockchain_scripthash_listunspent(sh)).map(u=>({...u,address:a.address,chain:a.chain,index:a.index}));
    })),
    Promise.all(addrs.map(a=>client.blockchain_scripthash_getBalance(getScriptHash(a.address,network)))),
  ]);
  const utxos=utxoLists.flat().map(u=>({...u,addrInfo:addrs.find(a=>a.address==u.address)}));
  const balance=bals.reduce((s,b)=>s+b.confirmed+b.unconfirmed,0);
  const feeRate=await estimateFee(client,conf);
  // Transactions
  const txByHash=new Map();
  for (const a of addrs)
    for (const tx of (a.hist||[]))
      txByHash.set(tx.tx_hash,tx);
  const hist=[...txByHash.values()].sort((a,b)=>(b.height||1e9)-(a.height||1e9));
  let transactions=[], ownedKeys=[];
  if (hist.length){
    const heights=[...new Set(hist.filter(t=>t.height>0).map(t=>t.height))];
    const [verboseTxs,...headers]=await Promise.all([
      Promise.all(hist.map(t=>client.blockchain_transaction_get(t.tx_hash,true))),
      ...heights.map(h=>client.blockchain_block_header(h)),
    ]);
    const tsMap={};
    heights.forEach((h,i)=>{ tsMap[h]=Buffer.from(headers[i],'hex').readUInt32LE(68); });
    const histTxIds=new Set(hist.map(t=>t.tx_hash));
    const prevIds=[...new Set(verboseTxs.flatMap(vtx=>(vtx.vin||[]).map(vin=>vin.txid).filter(id=>id&&!histTxIds.has(id))))];
    const prevList=await Promise.all(prevIds.map(id=>client.blockchain_transaction_get(id,true)));
    const prevMap={};
    prevIds.forEach((id,i)=>{ prevMap[id]=prevList[i]; });
    verboseTxs.forEach(vtx=>{ prevMap[vtx.txid]=vtx; });
    const voutToOurAmt=(vouts)=>(vouts||[]).reduce((sum,vout)=>{
      const as=vout.scriptPubKey?.addresses||(vout.scriptPubKey?.address?[vout.scriptPubKey.address]:[]);
      return as.some(a=>walletAddrSet.has(a))?sum+Math.round(vout.value*1e8):sum;
    },0);
    transactions=hist.map((tx,i)=>{
      const vtx=verboseTxs[i];
      const enrichedVin=(vtx.vin||[]).map(vin=>{
        if (!vin.txid) return vin;
        return {...vin,_prevVout:prevMap[vin.txid]?.vout?.[vin.vout]};
      });
      const received=voutToOurAmt(vtx.vout);
      const spent=enrichedVin.reduce((sum,vin)=>{
        if (!vin._prevVout) return sum;
        const as=vin._prevVout.scriptPubKey?.addresses||(vin._prevVout.scriptPubKey?.address?[vin._prevVout.scriptPubKey.address]:[]);
        return as.some(a=>walletAddrSet.has(a))?sum+Math.round(vin._prevVout.value*1e8):sum;
      },0);
      return {...tx,timestamp:tx.height>0?tsMap[tx.height]:null,amount:received-spent,_vtx:{...vtx,vin:enrichedVin}};
    });
    const keyMap=new Map();
    for (const etx of transactions){
      const vouts=etx._vtx?.vout||[];
      for (let i=0;i<vouts.length;i++){
        const vout=vouts[i];
        if (!vout.lif_kv) continue;
        const addr=vout.scriptPubKey?.address||vout.scriptPubKey?.addresses?.[0];
        if (!walletAddrSet.has(addr)) continue;
        for (const kv of vout.lif_kv){
          const isUnconfirmed=etx.height<=0;
          const priority=isUnconfirmed?Infinity:etx.height;
          const existing=keyMap.get(kv.key);
          if (!existing||priority>=existing._priority){
            const _kstatus=vout.spent?'spent':isUnconfirmed?'receiving':'confirmed';
            keyMap.set(kv.key,{key:kv.key,val:kv.val,tx:etx.tx_hash,vout:i,_kstatus,_priority:priority});
          }
        }
      }
    }
    ownedKeys=[...keyMap.values()];
  }
  const data={balance,receiveAddress,feeRate,addrs,changeAddrInfo,utxos,transactions,ownedKeys};
  store.data[wallet.id]=data;
  await dbPut('walletData:'+wallet.id,serializeWalletData(data));
  return data;
}

export async function estimateFee(client, conf){
  const fallback = conf.fee_def||1000;
  try {
    const rate = await client.request('blockchain.estimatefee', [6]);
    if (rate>0) return Math.round(rate*1e8);
  } catch(e){}
  return fallback;
}

export function calcFee(rateSatPerKb, tx){
  return Math.ceil(rateSatPerKb/1000*tx.virtualSize());
}

export function findAddrInWallet(root, accountPath, network, targetAddr){
  for (let ch=0; ch<2; ch++)
    for (let idx=0; idx<30; idx++){
      const info=deriveAddrAt(root,accountPath,network,ch,idx);
      if (info.address==targetAddr) return info;
    }
  return null;
}

// inputs: [{tx_hash, tx_pos, value, addrInfo:{address,keyPair}}]
export function buildSendTx(network, inputs, toAddr, amt, changeAddr, total, txFee, forEst=false){
  const p=new bitcoin.Psbt({network});
  for (const u of inputs) p.addInput({hash:u.tx_hash,index:u.tx_pos,witnessUtxo:{value:BigInt(u.value),script:bitcoin.address.toOutputScript(u.addrInfo.address,network)}});
  p.addOutput({address:toAddr,value:BigInt(amt)});
  const ch=total-amt-txFee; if(ch>546) p.addOutput({address:changeAddr,value:BigInt(ch)});
  for(let i=0;i<inputs.length;i++) p.signInput(i,inputs[i].addrInfo.keyPair);
  p.finalizeAllInputs(); return p.extractTransaction(forEst);
}

// inputs: [{tx_hash, tx_pos, value, addrInfo:{address,keyPair}}]
export function buildInscribeTx(network, inputs, script, changeAddr, total, txFee, forEst=false){
  const p=new bitcoin.Psbt({network});
  for (const u of inputs) p.addInput({hash:u.tx_hash,index:u.tx_pos,witnessUtxo:{value:BigInt(u.value),script:bitcoin.address.toOutputScript(u.addrInfo.address,network)}});
  p.addOutput({script,value:0n});
  p.addOutput({address:changeAddr,value:BigInt(total-txFee)});
  for(let i=0;i<inputs.length;i++) p.signInput(i,inputs[i].addrInfo.keyPair);
  p.finalizeAllInputs(); return p.extractTransaction(forEst);
}

// inputs: [{txid, vout, value, addr}], signers: [{keyPair}]
export function buildTransferTx(network, inputs, signers, toAddr, nameValue, extraTotal, changeAddr, txFee, forEst=false){
  const p=new bitcoin.Psbt({network});
  for (const inp of inputs) p.addInput({hash:inp.txid,index:inp.vout,witnessUtxo:{value:BigInt(inp.value),script:bitcoin.address.toOutputScript(inp.addr,network)}});
  if (nameValue<txFee){
    p.addOutput({address:toAddr,value:BigInt(nameValue)});
    const ch=extraTotal-txFee; if(ch>546) p.addOutput({address:changeAddr,value:BigInt(ch)});
  } else {
    p.addOutput({address:toAddr,value:BigInt(nameValue-txFee)});
  }
  for(let i=0;i<signers.length;i++) p.signInput(i,signers[i].keyPair);
  p.finalizeAllInputs(); return p.extractTransaction(forEst);
}

// inputs: [{txid, vout, value, addr}], signers: [{keyPair}]
export function buildEditTx(network, inputs, signers, script, dest, nameValue, extraTotal, changeAddr, txFee, forEst=false){
  const p=new bitcoin.Psbt({network});
  for (const inp of inputs) p.addInput({hash:inp.txid,index:inp.vout,witnessUtxo:{value:BigInt(inp.value),script:bitcoin.address.toOutputScript(inp.addr,network)}});
  p.addOutput({script,value:0n});
  if (nameValue<txFee){
    p.addOutput({address:dest,value:BigInt(nameValue)});
    const ch=extraTotal-txFee; if(ch>546) p.addOutput({address:changeAddr,value:BigInt(ch)});
  } else {
    p.addOutput({address:dest,value:BigInt(nameValue-txFee)});
  }
  for(let i=0;i<signers.length;i++) p.signInput(i,signers[i].keyPair);
  p.finalizeAllInputs(); return p.extractTransaction(forEst);
}


