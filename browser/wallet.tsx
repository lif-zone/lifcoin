// wallet.tsx - bright wallet - BTC, LIF, multi-wallet support
import React, {useState, useEffect, useMemo} from 'react';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import ecc from '@bitcoinerlab/secp256k1';
import {BIP32Factory} from 'bip32';
const bip32 = BIP32Factory(ecc);
import {ECPairFactory} from 'ecpair';
const ecpair = ECPairFactory(ecc);
import ElectrumClient from '@aguycalled/electrum-client-js';

// add Lif network, from lif-coin/lib/protocol/networks.js
bitcoin.networks.lif = {
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

const DEFAULT_NETWORKS = {
  mainnet: {
    name: 'Bitcoin Mainnet',
    symbol: 'BTC',
    network: bitcoin.networks.bitcoin,
    //electrum: 'wss://electrumx.nimiq.com:443/electrumx', // restricted from localhost:5000
    electrum: 'wss://bitcoinserver.nl:50004', // unrestricted
    // electrum: 'wss://electrum.blockstream.info:700', // does not work
    explorer_tx: 'https://mempool.space/tx/',
    coin_type: 0,
  },
  testnet: {
    name: 'Bitcoin Testnet',
    symbol: 'tBTC',
    network: bitcoin.networks.testnet,
    electrum: 'wss://electrum.blockstream.info:993',
    explorer_tx: 'https://mempool.space/testnet/tx/',
    coin_type: 1,
  },
  lif: {
    name: 'Lif Mainnet',
    symbol: 'LIF',
    network: bitcoin.networks.lif,
    electrum: 'ws://localhost:8432',
    coin_type: 0,
  },
};

function Electrum_connect(url){
  let u = URL.parse(url);
  let protocol = u.protocol.slice(0, -1);
  let port = u.port || (protocol=='wss' ? '443' : protocol=='ws' ? '80' : '');
  return new ElectrumClient(u.hostname, port+u.pathname, protocol);
}

function getNetworks(servers){
  const result = {};
  for (const key in DEFAULT_NETWORKS){
    result[key] = {...DEFAULT_NETWORKS[key]};
    if (servers[key])
      result[key].electrum = servers[key];
  }
  return result;
}

function getRoot(mnemonic, network, passphrase=''){
  return bip32.fromSeed(bip39.mnemonicToSeedSync(mnemonic, passphrase), network);
}

function deriveAddrAt(root, conf, network, chain, index){
  const child = root.derivePath(`m/84'/${conf.coin_type}'/0'/${chain}/${index}`);
  const {address} = bitcoin.payments.p2wpkh({pubkey: Buffer(child.publicKey), network});
  const keyPair = ecpair.fromPrivateKey(child.privateKey, {network});
  return {address, keyPair, chain, index};
}

function deriveWallet(mnemonic, networkKey, networks, passphrase=''){
  const conf = networks[networkKey];
  const network = conf.network;
  const root = getRoot(mnemonic, network, passphrase);
  const {address, keyPair} = deriveAddrAt(root, conf, network, 0, 0);
  return {address, keyPair, network, conf, root};
}

// Scan used addresses on chain (0=external, 1=change) with gap limit of 20.
// Returns {used: [{address, keyPair, chain, index, hist}], nextIndex}
async function scanAddresses(cl, root, conf, network, chain){
  const GAP = 20;
  const used = [];
  let lastUsed = -1;
  let start = 0;
  while (true){
    const entries = Array.from({length: GAP}, (_, i)=>deriveAddrAt(root, conf, network, chain, start+i));
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

function getScriptHash(addr, network){
  const script = bitcoin.address.toOutputScript(addr, network);
  const hash = bitcoin.crypto.sha256(script);
  return Buffer.from(hash.reverse()).toString('hex');
}

function loadWallets(){
  try {
    const saved = localStorage.getItem('wallets');
    if (saved)
      return JSON.parse(saved);
    // migrate old single-wallet format
    const oldMnemonic = localStorage.getItem('wallet_mnemonic');
    const oldNetwork = localStorage.getItem('wallet_network') || 'mainnet';
    if (oldMnemonic && bip39.validateMnemonic(oldMnemonic))
      return [{id: '1', name: '', network: oldNetwork, mnemonic: oldMnemonic, mode: 'single'}];
    return [];
  } catch { return []; }
}

function saveWallets(wallets){
  localStorage.setItem('wallets', JSON.stringify(wallets));
}

function loadServers(){
  try { return JSON.parse(localStorage.getItem('electrum_servers') || '{}'); }
  catch { return {}; }
}

function saveServers(servers){
  localStorage.setItem('electrum_servers', JSON.stringify(servers));
}

// Styles
const cardStyle = {
  border: '1px solid #ccc',
  borderRadius: 8,
  padding: 16,
  width: 220,
  cursor: 'pointer',
  background: '#f9f9f9',
  boxSizing: 'border-box',
};

const newCardStyle = {
  ...cardStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#eee',
  color: '#666',
};

// Main App
function BrightWallet(){
  const [wallets, setWallets] = useState(loadWallets);
  const [servers, setServers] = useState(loadServers);
  const [screen, setScreen] = useState('home');
  const [activeWalletId, setActiveWalletId] = useState(null);
  const networks = useMemo(()=>getNetworks(servers), [servers]);
  const addWallet = (wallet)=>{
    const updated = [...wallets, wallet];
    setWallets(updated);
    saveWallets(updated);
  };
  const deleteWallet = (id)=>{
    const updated = wallets.filter(w=>w.id!==id);
    setWallets(updated);
    saveWallets(updated);
    setScreen('home');
    setActiveWalletId(null);
  };
  const activeWallet = wallets.find(w=>w.id===activeWalletId);
  const goHome = ()=>setScreen('home');
  return (
    <div style={{fontFamily: 'sans-serif', maxWidth: 960, margin: '0 auto', padding: 16}}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          {screen!='home' &&
            <button onClick={goHome}>← Back</button>
          }
          <h1 style={{cursor: 'pointer', fontSize: 24, margin: 0, display: 'flex', alignItems: 'center', gap: 8}} onClick={goHome}>
            <img src={import.meta.resolve('./bright.ico')} style={{width: 32, height: 32}} />
            Bright Wallet
          </h1>
        </div>
        {screen=='home' &&
          <button onClick={()=>setScreen('settings')}>⚙ Settings</button>
        }
      </div>
      {screen=='home' && (
        <HomeScreen
          wallets={wallets}
          networks={networks}
          onSelect={(id)=>{ setActiveWalletId(id); setScreen('wallet-detail'); }}
          onAddNew={()=>setScreen('add-wallet')}
        />
      )}
      {screen=='add-wallet' && (
        <AddWalletScreen
          networks={networks}
          onAdd={(w)=>{ addWallet(w); goHome(); }}
          onCancel={goHome}
        />
      )}
      {screen=='wallet-detail' && activeWallet && (
        <WalletDetailScreen
          wallet={activeWallet}
          networks={networks}
          onDelete={()=>deleteWallet(activeWallet.id)}
          onBack={goHome}
        />
      )}
      {screen=='settings' && (
        <SettingsScreen
          servers={servers}
          networks={networks}
          onSave={(s)=>{ setServers(s); saveServers(s); }}
          onBack={goHome}
        />
      )}
    </div>
  );
}

// Home Screen
function HomeScreen({wallets, networks, onSelect, onAddNew}){
  return (
    <div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16}}>
        {wallets.map(wallet=>(
          <WalletCard
            key={wallet.id}
            wallet={wallet}
            networks={networks}
            onClick={()=>onSelect(wallet.id)}
          />
        ))}
        <div style={newCardStyle} onClick={onAddNew}>
          <div style={{textAlign: 'center'}}>
            <div style={{fontSize: 36, lineHeight: 1}}>+</div>
            <div style={{fontSize: 13, marginTop: 4}}>New Wallet</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Wallet Card (summary box on home screen)
function WalletCard({wallet, networks, onClick}){
  const [balance, setBalance] = useState(null);
  const [txCount, setTxCount] = useState(null);
  const [connErr, setConnErr] = useState(false);
  const conf = networks[wallet.network] || Object.values(networks)[0];
  const isHD = wallet.mode=='hd';
  const derived = useMemo(()=>{
    try { return deriveWallet(wallet.mnemonic, wallet.network, networks, wallet.passphrase||''); }
    catch { return null; }
  }, [wallet.id, wallet.network]);

  useEffect(()=>{
    if (!derived)
      return;
    const {root, address, network, conf} = derived;
    let cl;
    (async()=>{
      cl = Electrum_connect(conf.electrum);
      try {
        await cl.connect('lif-coin-wallet', '1.4');
        if (isHD){
          const [extRes, chgRes] = await Promise.all([
            scanAddresses(cl, root, conf, network, 0),
            scanAddresses(cl, root, conf, network, 1),
          ]);
          const allUsed = [...extRes.used, ...chgRes.used];
          const bals = await Promise.all(
            allUsed.map(a=>cl.blockchain_scripthash_getBalance(getScriptHash(a.address, network)))
          );
          setBalance(bals.reduce((s, b)=>s+b.confirmed+b.unconfirmed, 0));
          const allTxHashes = new Set(allUsed.flatMap(a=>(a.hist||[]).map(tx=>tx.tx_hash)));
          setTxCount(allTxHashes.size);
        } else {
          const sh = getScriptHash(address, network);
          const [bal, hist] = await Promise.all([
            cl.blockchain_scripthash_getBalance(sh),
            cl.blockchain_scripthash_getHistory(sh),
          ]);
          setBalance(bal.confirmed+bal.unconfirmed);
          setTxCount(hist.length);
        }
      } catch(e){
        console.error('WalletCard fetch error:', e);
        setConnErr(true);
      } finally {
        try { cl?.close(); } catch {}
      }
    })();
  }, [wallet.id, wallet.network, wallet.mode, conf.electrum]);

  if (!derived)
    return (
      <div style={{...cardStyle, color: 'red'}} onClick={onClick}>
        <p>Invalid wallet</p>
      </div>
    );

  const {address} = derived;
  const symbol = conf.symbol||'BTC';
  const label = wallet.name || (isHD ? 'HD Wallet' : address.slice(0, 10)+'...');
  return (
    <div style={cardStyle} onClick={onClick}>
      <div style={{fontWeight: 'bold', fontSize: 15}}>{label}</div>
      <div style={{fontSize: 12, color: '#888', marginTop: 2}}>
        {conf.name}{isHD ? ' · HD' : ''}
      </div>
      {!isHD && (
        <div style={{fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 4}}>
          {address.slice(0, 22)}...
        </div>
      )}
      <div style={{marginTop: 10}}>
        {connErr ? (
          <span style={{color: '#c00', fontSize: 12}}>Connection error</span>
        ) : balance===null ? (
          <span style={{color: '#aaa', fontSize: 12}}>Loading…</span>
        ) : (
          <>
            <div style={{fontWeight: 'bold'}}>
              {(balance/1e8).toFixed(8)} {symbol}
            </div>
            <div style={{fontSize: 12, color: '#666'}}>
              {txCount ? ''+txCount+' TXs' : 'No transactions'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Add Wallet Screen
function AddWalletScreen({networks, onAdd, onCancel}){
  const [networkKey, setNetworkKey] = useState('mainnet');
  const [keyMode, setKeyMode] = useState('generate'); // 'generate' | 'restore'
  const [addrMode, setAddrMode] = useState('hd'); // 'single' | 'hd'
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [name, setName] = useState('');
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const handleAdd = ()=>{
    setError('');
    let mnemonic;
    if (keyMode=='generate'){
      mnemonic = bip39.generateMnemonic();
    } else {
      const cleaned = mnemonicInput.trim().toLowerCase();
      if (!bip39.validateMnemonic(cleaned)){
        setError('Invalid mnemonic phrase');
        return;
      }
      mnemonic = cleaned;
    }
    const pp = usePassphrase ? passphrase : '';
    try {
      deriveWallet(mnemonic, networkKey, networks, pp);
    } catch(e){
      setError('Failed to derive wallet: '+e.message);
      return;
    }
    onAdd({id: Date.now().toString(), name: name.trim(), network: networkKey, mnemonic, mode: addrMode, passphrase: pp});
  };
  return (
    <div style={{maxWidth: 480}}>
      <h2>Add Wallet</h2>
      <div style={{marginTop: 12}}>
        <label>Name (optional):</label>
        <input
          value={name}
          onChange={e=>setName(e.target.value)}
          placeholder="My Wallet"
          style={{display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box'}}
        />
      </div>
      <div style={{marginTop: 12}}>
        <label>Network:</label>
        <select
          value={networkKey}
          onChange={e=>setNetworkKey(e.target.value)}
          style={{display: 'block', width: '100%', marginTop: 4}}
        >
          {Object.entries(networks).map(([key, conf])=>(
            <option key={key} value={key}>{conf.name}</option>
          ))}
        </select>
      </div>
      <div style={{marginTop: 12}}>
        <label>Address mode:</label>
        <select
          value={addrMode}
          onChange={e=>setAddrMode(e.target.value)}
          style={{display: 'block', width: '100%', marginTop: 4}}
        >
          <option value="single">Same address for all transactions</option>
          <option value="hd">Unique address for each transaction (BIP84)</option>
        </select>
      </div>
      <div style={{marginTop: 12}}>
        <label>Wallet key:</label>
        <div style={{display: 'flex', gap: 8, marginTop: 4}}>
          <button
            onClick={()=>setKeyMode('generate')}
            style={{fontWeight: keyMode=='generate' ? 'bold' : 'normal'}}
          >Generate new</button>
          <button
            onClick={()=>setKeyMode('restore')}
            style={{fontWeight: keyMode=='restore' ? 'bold' : 'normal'}}
          >Restore from mnemonic</button>
        </div>
        {keyMode=='restore' && (
          <textarea
            rows={4}
            placeholder="Enter the wallet's secret 12/24 words"
            value={mnemonicInput}
            onChange={e=>setMnemonicInput(e.target.value)}
            style={{display: 'block', width: '100%', marginTop: 8, boxSizing: 'border-box'}}
          />
        )}
        {keyMode=='generate' && (
          <p style={{color: '#666', fontSize: 13, marginTop: 8}}>
            A new mnemonic will be generated. Back it up after adding!
          </p>
        )}
      </div>
      <div style={{marginTop: 12}}>
        <label style={{display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}>
          <input
            type="checkbox"
            checked={usePassphrase}
            onChange={e=>setUsePassphrase(e.target.checked)}
          />
          Passphrase (BIP39)
        </label>
        {usePassphrase && (
          <input
            type="text"
            placeholder="Passphrase"
            value={passphrase}
            onChange={e=>setPassphrase(e.target.value)}
            style={{display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box'}}
          />
        )}
      </div>
      {error && <p style={{color: 'red', marginTop: 8}}>{error}</p>}
      <div style={{marginTop: 16, display: 'flex', gap: 8}}>
        <button onClick={handleAdd}>Add Wallet</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Wallet Detail Screen
function WalletDetailScreen({wallet, networks, onDelete, onBack}){
  const conf = networks[wallet.network] || Object.values(networks)[0];
  const network = conf.network;
  const isHD = wallet.mode=='hd';
  const [client, setClient] = useState(null);
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [subscreen, setSubscreen] = useState('overview');
  const [selectedTx, setSelectedTx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const [receiveAddress, setReceiveAddress] = useState(null);
  const [allAddrs, setAllAddrs] = useState([]);
  const [changeAddrInfo, setChangeAddrInfo] = useState(null);

  const fetchData = async (cl)=>{
    setLoading(true);
    try {
      const root = getRoot(wallet.mnemonic, network, wallet.passphrase||'');
      let addrs, recvAddr, chgAddr;
      if (isHD){
        const [extRes, chgRes] = await Promise.all([
          scanAddresses(cl, root, conf, network, 0),
          scanAddresses(cl, root, conf, network, 1),
        ]);
        addrs = [...extRes.used, ...chgRes.used];
        recvAddr = deriveAddrAt(root, conf, network, 0, extRes.nextIndex).address;
        chgAddr = deriveAddrAt(root, conf, network, 1, chgRes.nextIndex);
      } else {
        const single = deriveAddrAt(root, conf, network, 0, 0);
        const hist = await cl.blockchain_scripthash_getHistory(getScriptHash(single.address, network));
        addrs = [{...single, hist}];
        recvAddr = single.address;
        chgAddr = single;
      }
      setReceiveAddress(recvAddr);
      setAllAddrs(addrs);
      setChangeAddrInfo(chgAddr);
      const walletAddrSet = new Set(addrs.map(a=>a.address));
      // Fetch balances
      const bals = await Promise.all(
        addrs.map(a=>cl.blockchain_scripthash_getBalance(getScriptHash(a.address, network)))
      );
      setBalance(bals.reduce((s, b)=>s+b.confirmed+b.unconfirmed, 0));
      // Deduplicate txs across all addresses, sort by height desc
      const txByHash = new Map();
      for (const a of addrs){
        for (const tx of (a.hist||[]))
          txByHash.set(tx.tx_hash, tx);
      }
      const hist = [...txByHash.values()].sort((a, b)=>(b.height||1e9)-(a.height||1e9));
      if (!hist.length){
        setTransactions([]);
        return;
      }
      // Fetch verbose txs + block headers in parallel
      const heights = [...new Set(hist.filter(tx=>tx.height>0).map(tx=>tx.height))];
      const [verboseTxs, ...headers] = await Promise.all([
        Promise.all(hist.map(tx=>cl.blockchain_transaction_get(tx.tx_hash, true))),
        ...heights.map(h=>cl.blockchain_block_header(h)),
      ]);
      // Timestamps
      const tsMap = {};
      heights.forEach((h, i)=>{ tsMap[h] = Buffer.from(headers[i], 'hex').readUInt32LE(68); });
      // Prev txs for input resolution
      const histTxIds = new Set(hist.map(tx=>tx.tx_hash));
      const prevIds = [...new Set(
        verboseTxs.flatMap(vtx=>(vtx.vin||[]).map(vin=>vin.txid).filter(id=>id && !histTxIds.has(id)))
      )];
      const prevList = await Promise.all(prevIds.map(id=>cl.blockchain_transaction_get(id, true)));
      const prevMap = {};
      prevIds.forEach((id, i)=>{ prevMap[id] = prevList[i]; });
      verboseTxs.forEach(vtx=>{ prevMap[vtx.txid] = vtx; });
      const voutToOurAmt = (vouts)=>
        (vouts||[]).reduce((sum, vout)=>{
          const as = vout.scriptPubKey?.addresses || (vout.scriptPubKey?.address ? [vout.scriptPubKey.address] : []);
          return as.some(a=>walletAddrSet.has(a)) ? sum+Math.round(vout.value*1e8) : sum;
        }, 0);
      setTransactions(hist.map((tx, i)=>{
        const vtx = verboseTxs[i];
        // enrich vin with prev vout for TxDetailScreen
        const enrichedVin = (vtx.vin||[]).map(vin=>{
          if (!vin.txid) return vin; // coinbase
          return {...vin, _prevVout: prevMap[vin.txid]?.vout?.[vin.vout]};
        });
        const received = voutToOurAmt(vtx.vout);
        const spent = enrichedVin.reduce((sum, vin)=>{
          if (!vin._prevVout) return sum;
          const as = vin._prevVout.scriptPubKey?.addresses || (vin._prevVout.scriptPubKey?.address ? [vin._prevVout.scriptPubKey.address] : []);
          return as.some(a=>walletAddrSet.has(a)) ? sum+Math.round(vin._prevVout.value*1e8) : sum;
        }, 0);
        return {
          ...tx,
          timestamp: tx.height>0 ? tsMap[tx.height] : null,
          amount: received-spent,
          _vtx: {...vtx, vin: enrichedVin},
        };
      }));
    } catch(e){
      console.error('fetchData error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(()=>{
    try { getRoot(wallet.mnemonic, network, wallet.passphrase||''); } catch(e){ return; }
    const cl = Electrum_connect(conf.electrum);
    (async()=>{
      try {
        await cl.connect('lif-coin-wallet', '1.4');
        setClient(cl);
        fetchData(cl);
      } catch(e){
        console.error('Connect error:', e);
        setConnErr(true);
      }
    })();
    return ()=>cl.close();
  }, [wallet.id, wallet.network]);

  const symbol = conf.symbol||'BTC';
  const label = wallet.name || (isHD ? 'HD Wallet' : (receiveAddress||'…').slice(0, 12)+'…');
  const handleDelete = ()=>{
    if (window.confirm(`Delete wallet "${label}"?\n\nMake sure you have backed up the mnemonic!`))
      onDelete();
  };
  return (
    <div>
      <h2>{label}</h2>
      <div style={{color: '#888', fontSize: 13}}>
        {conf.name}{isHD ? ' · HD (BIP84)' : ' · Single address'}
      </div>
      {connErr && (
        <p style={{color: '#c00', marginTop: 8}}>
          Failed to connect to Electrum server ({conf.electrum})
        </p>
      )}
      <div style={{marginTop: 6}}>
        <strong>Balance:</strong>{' '}
        {balance===null
          ? (connErr ? 'unavailable' : 'loading…')
          : `${(balance/1e8).toFixed(8)} ${symbol}`
        }
      </div>
      <div style={{display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center'}}>
        <button
          onClick={()=>setSubscreen('overview')}
          style={{fontWeight: subscreen=='overview' ? 'bold' : 'normal'}}
        >Overview</button>
        <button
          onClick={()=>setSubscreen('receive')}
          disabled={!receiveAddress}
          style={{fontWeight: subscreen=='receive' ? 'bold' : 'normal'}}
        >Receive</button>
        <button
          onClick={()=>setSubscreen('send')}
          disabled={!client || !allAddrs.length}
          style={{fontWeight: subscreen=='send' ? 'bold' : 'normal'}}
        >Send</button>
        <button
          onClick={()=>setSubscreen('backup')}
          style={{fontWeight: subscreen=='backup' ? 'bold' : 'normal'}}
        >Backup</button>
        <button
          onClick={handleDelete}
          style={{marginLeft: 'auto', color: '#c00', border: '1px solid #c00', background: 'transparent'}}
        >Delete Wallet</button>
      </div>

      {subscreen=='overview' && (
        <div style={{marginTop: 16}}>
          <h3>Transactions</h3>
          {loading ? (
            <p style={{color: '#aaa'}}>Loading…</p>
          ) : !transactions.length ? (
            <p>No transactions yet.</p>
          ) : (
            <ul style={{marginTop: 8, paddingLeft: 0, listStyle: 'none'}}>
              {transactions.map((tx, i)=>{
                const positive = tx.amount>=0;
                return (
                  <li key={i}
                    onClick={()=>{ setSelectedTx(tx); setSubscreen('tx-detail'); }}
                    style={{fontSize: 13, marginTop: 4, cursor: 'pointer', padding: '4px 0',
                      borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between'}}
                  >
                    <span>
                      {tx.timestamp
                        ? new Date(tx.timestamp*1000).toLocaleString()
                        : <span style={{color: '#f90'}}>unconfirmed</span>
                      }
                    </span>
                    <span style={{fontFamily: 'monospace', color: positive ? 'green' : '#c00'}}>
                      {positive ? '+' : ''}{(tx.amount/1e8).toFixed(8)} {symbol}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {client && (
            <button style={{marginTop: 10}} onClick={()=>fetchData(client)}>
              Refresh
            </button>
          )}
        </div>
      )}
      {subscreen=='tx-detail' && selectedTx && (
        <TxDetailScreen
          tx={selectedTx}
          conf={conf}
          walletAddrs={new Set(allAddrs.map(a=>a.address))}
          onBack={()=>setSubscreen('overview')}
        />
      )}
      {subscreen=='receive' && receiveAddress && (
        <ReceiveScreen
          address={receiveAddress}
          isHD={isHD}
          symbol={symbol}
        />
      )}
      {subscreen=='send' && client && allAddrs.length>0 && (
        <SendScreen
          client={client}
          addrs={allAddrs}
          changeAddrInfo={changeAddrInfo}
          network={network}
          conf={conf}
          onSent={()=>{ setSubscreen('overview'); fetchData(client); }}
        />
      )}
      {subscreen=='backup' && (
        <div style={{marginTop: 16, maxWidth: 480}}>
          <h3>Backup Mnemonic</h3>
          <p style={{color: '#c00', fontSize: 13, marginTop: 4}}>
            Keep this secret! Anyone with these words can steal your funds.
          </p>
          <div style={{
            fontFamily: 'monospace',
            background: '#f4f4f4',
            border: '1px solid #ccc',
            borderRadius: 4,
            padding: 12,
            marginTop: 8,
            wordBreak: 'break-word',
            fontSize: 15,
            lineHeight: 1.8,
          }}>
            {wallet.mnemonic}
          </div>
        </div>
      )}
    </div>
  );
}

// Receive Screen
function ReceiveScreen({address, isHD, symbol}){
  return (
    <div style={{marginTop: 16, maxWidth: 480}}>
      <h3>Receive {symbol}</h3>
      {isHD && (
        <p style={{color: '#666', fontSize: 13, marginTop: 4}}>
          Fresh address — a new one will appear after it receives funds.
        </p>
      )}
      <div style={{
        fontFamily: 'monospace',
        background: '#f4f4f4',
        border: '1px solid #ccc',
        borderRadius: 4,
        padding: 12,
        marginTop: 8,
        wordBreak: 'break-all',
        fontSize: 14,
      }}>
        {address}
      </div>
    </div>
  );
}

// Tx Detail Screen
function TxDetailScreen({tx, conf, walletAddrs, onBack}){
  const date = tx.timestamp ? new Date(tx.timestamp*1000).toLocaleString() : null;
  const positive = tx.amount>=0;
  const symbol = conf.symbol||'BTC';
  const voutAddr = (vout)=>vout.scriptPubKey?.address || vout.scriptPubKey?.addresses?.[0] || '?';
  return (
    <div style={{marginTop: 16, maxWidth: 600}}>
      <button onClick={onBack}>← Back</button>
      <h3 style={{marginTop: 8}}>Transaction</h3>
      <div style={{marginTop: 8}}>
        <strong>Date:</strong> {date || <span style={{color: '#f90'}}>unconfirmed</span>}
      </div>
      {tx.height>0 &&
        <div style={{marginTop: 4}}><strong>Block:</strong> {tx.height}</div>
      }
      {tx.amount!==undefined &&
        <div style={{marginTop: 4}}>
          <strong>Amount:</strong>{' '}
          <span style={{fontFamily: 'monospace', color: positive ? 'green' : '#c00'}}>
            {positive ? '+' : ''}{(tx.amount/1e8).toFixed(8)} {symbol}
          </span>
        </div>
      }
      <div style={{marginTop: 8}}><strong>TXID:</strong></div>
      <div style={{fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 13, marginTop: 2}}>
        {tx.tx_hash}
      </div>
      {conf.explorer_tx && (
        <div style={{marginTop: 8}}>
          <a href={conf.explorer_tx+tx.tx_hash} target="_blank" rel="noreferrer">
            View on block explorer
          </a>
        </div>
      )}
      {tx._vtx && (<>
        <h4 style={{marginTop: 16}}>Inputs</h4>
        {(tx._vtx.vin||[]).map((vin, i)=>{
          if (!vin.txid)
            return <div key={i} style={{fontSize: 12, color: '#888'}}>Coinbase</div>;
          const addr = vin._prevVout ? voutAddr(vin._prevVout) : '?';
          const val = vin._prevVout ? Math.round(vin._prevVout.value*1e8) : null;
          const ours = walletAddrs.has(addr);
          return (
            <div key={i} style={{fontFamily: 'monospace', fontSize: 12, marginTop: 3,
              color: ours ? '#c00' : 'inherit'}}
            >
              {addr}{val!==null && ` (${(val/1e8).toFixed(8)} ${symbol})`}{ours && ' ← yours'}
            </div>
          );
        })}
        <h4 style={{marginTop: 12}}>Outputs</h4>
        {(tx._vtx.vout||[]).map((vout, i)=>{
          const addr = voutAddr(vout);
          const val = Math.round(vout.value*1e8);
          const ours = walletAddrs.has(addr);
          return (
            <div key={i} style={{fontFamily: 'monospace', fontSize: 12, marginTop: 3,
              color: ours ? 'green' : 'inherit'}}
            >
              {addr}: {(val/1e8).toFixed(8)} {symbol}{ours && ' ← yours'}
            </div>
          );
        })}
      </>)}
    </div>
  );
}

// Send Screen
function SendScreen({client, addrs, changeAddrInfo, network, conf, onSent}){
  const [toAddress, setToAddress] = useState('');
  const [amountSat, setAmountSat] = useState('');
  const [sending, setSending] = useState(false);
  const handleSend = async ()=>{
    if (!client || !addrs.length)
      return;
    const amountValue = parseInt(amountSat, 10);
    if (isNaN(amountValue) || amountValue<=0)
      return alert('Invalid amount');
    // Collect UTXOs from all addresses
    let allUTXOs = [];
    try {
      const lists = await Promise.all(
        addrs.map(async (addrInfo)=>{
          const sh = getScriptHash(addrInfo.address, network);
          const utxos = await client.blockchain_scripthash_listunspent(sh);
          return utxos.map(u=>({...u, addrInfo}));
        })
      );
      allUTXOs = lists.flat();
    } catch(err){
      return alert('Failed to fetch UTXOs');
    }
    if (!allUTXOs.length)
      return alert('No funds available');
    // Select UTXOs largest-first until amount+fee covered
    allUTXOs.sort((a, b)=>b.value-a.value);
    const fee = 2000;
    const selected = [];
    let total = 0;
    for (const utxo of allUTXOs){
      selected.push(utxo);
      total += utxo.value;
      if (total >= amountValue+fee)
        break;
    }
    if (total < amountValue+fee)
      return alert('Insufficient balance');
    const psbt = new bitcoin.Psbt({network});
    for (const utxo of selected){
      psbt.addInput({
        hash: utxo.tx_hash,
        index: utxo.tx_pos,
        witnessUtxo: {
          value: utxo.value,
          script: bitcoin.address.toOutputScript(utxo.addrInfo.address, network),
        },
      });
    }
    psbt.addOutput({address: toAddress, value: amountValue});
    const change = total-amountValue-fee;
    if (change>546)
      psbt.addOutput({address: changeAddrInfo.address, value: change});
    for (let i=0; i<selected.length; i++)
      psbt.signInput(i, selected[i].addrInfo.keyPair);
    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();
    setSending(true);
    try {
      const txid = await client.blockchain_transaction_broadcast(txHex);
      const explorerLink = conf.explorer_tx ? `\n${conf.explorer_tx}${txid}` : '';
      alert(`Transaction sent!\nTXID: ${txid}${explorerLink}`);
      setToAddress('');
      setAmountSat('');
      onSent?.();
    } catch(err){
      alert('Broadcast failed: '+err.message);
    } finally {
      setSending(false);
    }
  };
  const symbol = conf.symbol||'BTC';
  return (
    <div style={{marginTop: 16, maxWidth: 400}}>
      <h3>Send {symbol}</h3>
      <input
        placeholder="Recipient address"
        value={toAddress}
        onChange={e=>setToAddress(e.target.value)}
        style={{display: 'block', width: '100%', marginTop: 8, boxSizing: 'border-box'}}
      />
      <input
        type="number"
        placeholder="Amount (satoshis)"
        value={amountSat}
        onChange={e=>setAmountSat(e.target.value)}
        style={{display: 'block', width: '100%', marginTop: 8, boxSizing: 'border-box'}}
      />
      <button onClick={handleSend} disabled={sending} style={{marginTop: 8}}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

// Settings Screen
function SettingsScreen({servers, networks, onSave, onBack}){
  const [values, setValues] = useState(()=>{
    const v = {};
    for (const key in networks)
      v[key] = servers[key] || networks[key].electrum;
    return v;
  });
  const handleSave = ()=>{
    const newServers = {};
    for (const key in networks){
      const val = values[key]?.trim();
      if (val)
        newServers[key] = val;
    }
    onSave(newServers);
    alert('Settings saved');
  };
  const handleReset = (key)=>{
    setValues(v=>({...v, [key]: DEFAULT_NETWORKS[key]?.electrum || ''}));
  };
  return (
    <div style={{maxWidth: 520}}>
      <h2>Settings</h2>
      <h3 style={{marginTop: 16}}>ElectrumX Servers</h3>
      <p style={{fontSize: 13, color: '#666', marginTop: 4}}>
        Configure the ElectrumX server URL for each network.
      </p>
      {Object.entries(networks).map(([key, conf])=>(
        <div key={key} style={{marginTop: 14}}>
          <label style={{fontWeight: 'bold'}}>{conf.name}:</label>
          <div style={{display: 'flex', gap: 6, marginTop: 4}}>
            <input
              value={values[key] || ''}
              onChange={e=>setValues(v=>({...v, [key]: e.target.value}))}
              placeholder={DEFAULT_NETWORKS[key]?.electrum}
              style={{flex: 1, fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box'}}
            />
            <button onClick={()=>handleReset(key)} title="Reset to default">↺</button>
          </div>
        </div>
      ))}
      <button onClick={handleSave} style={{marginTop: 20}}>Save Settings</button>
    </div>
  );
}

export default BrightWallet;
