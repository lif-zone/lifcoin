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
    name: 'Lif Mainnet', // Life Chai
    symbol: 'LIF',
    network: networks_lif,
    electrum: 'ws://localhost:8432',
    explorer_tx: 'http://localhost:5000/tx/',
    coin_type: 1842,
  },
};

function json(o){
  if (!o) debugger;
  if (!o) return '';
  return JSON.stringify(o);
}
function trunc(s, len){
  return s.length>len ? s.slice(0, len)+'…' : s;
}

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

function defaultDerivPath(conf){
  return `m/84'/${conf.coin_type}'/0'`;
}

function deriveAddrAt(root, accountPath, network, chain, index){
  const child = root.derivePath(`${accountPath}/${chain}/${index}`);
  const pubkey = child.publicKey;
  const {address} = bitcoin.payments.p2wpkh({pubkey, network});
  const keyPair = ecpair.fromPrivateKey(child.privateKey, {network});
  return {address, keyPair, chain, index};
}

function deriveWallet(mnemonic, networkKey, networks, passphrase='', derivPath=null){
  const conf = networks[networkKey];
  const network = conf.network;
  const root = getRoot(mnemonic, network, passphrase);
  const accountPath = derivPath || defaultDerivPath(conf);
  const {address, keyPair} = deriveAddrAt(root, accountPath, network, 0, 0);
  return {address, keyPair, network, conf, root};
}

// Scan used addresses on chain (0=external, 1=change) with gap limit of 20.
// Returns {used: [{address, keyPair, chain, index, hist}], nextIndex}
async function scanAddresses(cl, root, accountPath, network, chain){
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

function getScriptHash(addr, network){
  const script = bitcoin.address.toOutputScript(addr, network);
  const hash = bitcoin.crypto.sha256(script);
  return Buffer.from(hash.reverse()).toString('hex');
}

function loadWallets(){
  try {
    const saved = localStorage.getItem('wallets');
    return saved ? JSON.parse(saved) : [];
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
  const [selectedTxData, setSelectedTxData] = useState(null);
  const [selectedKeyData, setSelectedKeyData] = useState(null);
  const networks = useMemo(()=>getNetworks(servers), [servers]);
  const addWallet = (wallet)=>{
    const updated = [...wallets, wallet];
    setWallets(updated);
    saveWallets(updated);
  };
  const updateWallet = (id, changes)=>{
    const updated = wallets.map(w=>w.id===id ? {...w, ...changes} : w);
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
  const goBack = ()=>{
    if (screen=='name-transfer' || screen=='name-edit')
      setScreen('key-detail');
    else if (screen=='tx-detail' || screen=='key-detail')
      setScreen('wallet-detail');
    else
      goHome();
  };
  return (
    <div style={{fontFamily: 'sans-serif', maxWidth: 960, margin: '0 auto', padding: 16}}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
          {screen!='home' &&
            <button onClick={goBack}>← Back</button>
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
          wallets={wallets}
          onAdd={(w)=>{ addWallet(w); goHome(); }}
          onCancel={goHome}
        />
      )}
      {screen=='wallet-detail' && activeWallet && (
        <WalletDetailScreen
          wallet={activeWallet}
          networks={networks}
          onDelete={()=>deleteWallet(activeWallet.id)}
          onUpdate={(changes)=>updateWallet(activeWallet.id, changes)}
          onBack={goHome}
          onSelectTx={(data)=>{ setSelectedTxData(data); setScreen('tx-detail'); }}
          onSelectKey={(data)=>{ setSelectedKeyData(data); setScreen('key-detail'); }}
        />
      )}
      {screen=='tx-detail' && selectedTxData && activeWallet && (
        <TxDetailScreen
          tx={selectedTxData.tx}
          conf={selectedTxData.conf}
          walletAddrs={selectedTxData.walletAddrs}
          walletName={activeWallet.name || (activeWallet.mode=='hd' ? 'HD Wallet' : 'Wallet')}
        />
      )}
      {screen=='key-detail' && selectedKeyData && activeWallet && (
        <KeyDetailScreen
          keyData={selectedKeyData}
          conf={networks[activeWallet.network] || Object.values(networks)[0]}
          onViewTx={(tx)=>{ setSelectedTxData({tx, conf: networks[activeWallet.network]||Object.values(networks)[0], walletAddrs: selectedKeyData._walletAddrs}); setScreen('tx-detail'); }}
          onTransfer={()=>setScreen('name-transfer')}
          onEdit={(newVal)=>{ setSelectedKeyData(d=>({...d, _editVal: newVal})); setScreen('name-edit'); }}
        />
      )}
      {screen=='name-transfer' && selectedKeyData && activeWallet && (
        <NameTransferScreen
          wallet={activeWallet}
          networks={networks}
          keyData={selectedKeyData}
          onSent={()=>setScreen('wallet-detail')}
        />
      )}
      {screen=='name-edit' && selectedKeyData && activeWallet && (
        <NameEditScreen
          wallet={activeWallet}
          networks={networks}
          keyData={selectedKeyData}
          onSent={()=>setScreen('wallet-detail')}
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
  const [keysOwned, setKeysOwned] = useState(0);
  const [connErr, setConnErr] = useState(false);
  const conf = networks[wallet.network] || Object.values(networks)[0];
  const derived = useMemo(()=>{
    try { return deriveWallet(wallet.mnemonic, wallet.network, networks, wallet.passphrase||'', wallet.derivPath||null); }
    catch { return null; }
  }, [wallet.id, wallet.network]);

  useEffect(()=>{
    if (!derived)
      return;
    const {root, network, conf} = derived;
    let cl;
    (async()=>{
      cl = Electrum_connect(conf.electrum);
      try {
        await cl.connect('lif-coin-wallet', '1.4');
        const accountPath = wallet.derivPath || defaultDerivPath(conf);
        const [extRes, chgRes] = await Promise.all([
          scanAddresses(cl, root, accountPath, network, 0),
          scanAddresses(cl, root, accountPath, network, 1),
        ]);
        const allUsed = [...extRes.used, ...chgRes.used];
        const bals = await Promise.all(
          allUsed.map(a=>cl.blockchain_scripthash_getBalance(getScriptHash(a.address, network)))
        );
        setBalance(bals.reduce((s, b)=>s+b.confirmed+b.unconfirmed, 0));
        setKeysOwned(bals.reduce((s, b)=>s+(b.lif_kv?.confirmed?.length||0)+(b.lif_kv?.unconfirmed?.length||0), 0));
        const allTxHashes = new Set(allUsed.flatMap(a=>(a.hist||[]).map(tx=>tx.tx_hash)));
        setTxCount(allTxHashes.size);
      } catch(e){
        console.error('WalletCard fetch error:', e);
        setConnErr(true);
      } finally {
        try { cl?.close(); } catch {}
      }
    })();
  }, [wallet.id, wallet.network, conf.electrum]);

  if (!derived){
    return (
      <div style={{...cardStyle, color: 'red'}} onClick={onClick}>
        <p>Invalid wallet</p>
      </div>
    );
  }

  const symbol = conf.symbol||'BTC';
  const label = wallet.name || '';
  return (
    <div style={cardStyle} onClick={onClick}>
      <div style={{fontWeight: 'bold', fontSize: 15}}>{label}</div>

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
            {keysOwned > 0 && (
              <div style={{fontSize: 12, color: '#666'}}>
                {keysOwned} {keysOwned===1?'Name':'Names'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Add Wallet Screen
function AddWalletScreen({networks, wallets, onAdd, onCancel}){
  const [networkKey, setNetworkKey] = useState('mainnet');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [derivPath, setDerivPath] = useState(()=>defaultDerivPath(networks['mainnet']));
  const [mnemonicInput, setMnemonicInput] = useState('');
  const defaultName = (()=>{
    let max = 0;
    for (const w of wallets){
      const m = w.name && w.name.match(/^Wallet #(\d+)$/);
      if (m)
        max = Math.max(max, parseInt(m[1], 10));
    }
    return 'Wallet #'+(max+1);
  })();
  const [name, setName] = useState(defaultName);
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const handleGenerate = ()=>{
    setMnemonicInput(bip39.generateMnemonic());
  };
  const handleAdd = ()=>{
    setError('');
    const cleaned = mnemonicInput.trim().toLowerCase();
    if (!bip39.validateMnemonic(cleaned)){
      setError('Invalid mnemonic phrase');
      return;
    }
    const mnemonic = cleaned;
    const pp = usePassphrase ? passphrase : '';
    const dp = showAdvanced ? derivPath.trim() : null;
    try {
      deriveWallet(mnemonic, networkKey, networks, pp, dp);
    } catch(e){
      setError('Failed to derive wallet: '+e.message);
      return;
    }
    onAdd({id: Date.now().toString(), name: name.trim(), network: networkKey, mnemonic, passphrase: pp, derivPath: dp});
  };
  return (
    <div style={{maxWidth: 480}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <h2 style={{margin: 0}}>Add Wallet</h2>
        {!showAdvanced &&
          <button onClick={()=>setShowAdvanced(true)}>Advanced</button>
        }
      </div>
      <div style={{marginTop: 12}}>
        <label>Name:</label>
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
          onChange={e=>{ setNetworkKey(e.target.value); setDerivPath(defaultDerivPath(networks[e.target.value])); }}
          style={{display: 'block', width: '100%', marginTop: 4}}
        >
          {Object.entries(networks).map(([key, conf])=>(
            <option key={key} value={key}>{conf.name}</option>
          ))}
        </select>
      </div>
      <div style={{marginTop: 12}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <label>Mnemonic:</label>
          <button onClick={handleGenerate}>Generate</button>
        </div>
        <textarea
          rows={4}
          placeholder={'Enter the 12 or 24 words of your wallet, or click "Generate" to create a new wallet.'}
          value={mnemonicInput}
          onChange={e=>setMnemonicInput(e.target.value)}
          style={{display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box'}}
        />
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
      {showAdvanced && (
        <div style={{marginTop: 12}}>
          <label>Derivation path:</label>
          <input
            value={derivPath}
            onChange={e=>setDerivPath(e.target.value)}
            style={{display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace',
              fontSize: 13, boxSizing: 'border-box'}}
          />
        </div>
      )}
      {error && <p style={{color: 'red', marginTop: 8}}>{error}</p>}
      <div style={{marginTop: 16, display: 'flex', gap: 8}}>
        <button onClick={handleAdd}>Add Wallet</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Wallet Detail Screen
function WalletDetailScreen({wallet, networks, onDelete, onUpdate, onBack, onSelectTx, onSelectKey}){
  const conf = networks[wallet.network] || Object.values(networks)[0];
  const network = conf.network;
  const [client, setClient] = useState(null);
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [ownedKeys, setOwnedKeys] = useState([]);
  const [subscreen, setSubscreen] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const [receiveAddress, setReceiveAddress] = useState(null);
  const [allAddrs, setAllAddrs] = useState([]);
  const [changeAddrInfo, setChangeAddrInfo] = useState(null);

  const fetchData = async (cl)=>{
    setLoading(true);
    try {
      const root = getRoot(wallet.mnemonic, network, wallet.passphrase||'');
      const accountPath = wallet.derivPath || defaultDerivPath(conf);
      const [extRes, chgRes] = await Promise.all([
        scanAddresses(cl, root, accountPath, network, 0),
        scanAddresses(cl, root, accountPath, network, 1),
      ]);
      const addrs = [...extRes.used, ...chgRes.used];
      const recvAddr = deriveAddrAt(root, accountPath, network, 0, extRes.nextIndex).address;
      const chgAddr = deriveAddrAt(root, accountPath, network, 1, chgRes.nextIndex);
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
        setOwnedKeys([]);
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
      const enrichedTxs = hist.map((tx, i)=>{
        const vtx = verboseTxs[i];
        // enrich vin with prev vout for TxDetailScreen
        const enrichedVin = (vtx.vin||[]).map(vin=>{
          if (!vin.txid)
            return vin; // coinbase
          return {...vin, _prevVout: prevMap[vin.txid]?.vout?.[vin.vout]};
        });
        const received = voutToOurAmt(vtx.vout);
        const spent = enrichedVin.reduce((sum, vin)=>{
          if (!vin._prevVout)
            return sum;
          const as = vin._prevVout.scriptPubKey?.addresses || (vin._prevVout.scriptPubKey?.address ? [vin._prevVout.scriptPubKey.address] : []);
          return as.some(a=>walletAddrSet.has(a)) ? sum+Math.round(vin._prevVout.value*1e8) : sum;
        }, 0);
        return {
          ...tx,
          timestamp: tx.height>0 ? tsMap[tx.height] : null,
          amount: received-spent,
          _vtx: {...vtx, vin: enrichedVin},
        };
      });
      setTransactions(enrichedTxs);
      // Build ownedKeys from vouts — most recent tx per key wins (unconfirmed > higher height)
      const keyMap = new Map();
      for (const enrichedTx of enrichedTxs){
        const vouts = enrichedTx._vtx?.vout || [];
        for (let i=0; i<vouts.length; i++){
          const vout = vouts[i];
          if (!vout.lif_kv)
            continue;
          const addr = vout.scriptPubKey?.address || vout.scriptPubKey?.addresses?.[0];
          if (!walletAddrSet.has(addr))
            continue;
          for (let kv of vout.lif_kv){
            const keyName = kv.key;
            const isUnconfirmed = enrichedTx.height<=0;
            const priority = isUnconfirmed ? Infinity : enrichedTx.height;
            const existing = keyMap.get(keyName);
            if (!existing || priority>=existing._priority){
              let _kstatus;
              if (vout.spent)
                _kstatus = 'spent';
              else if (isUnconfirmed)
                _kstatus = 'receiving';
              else
                _kstatus = 'confirmed';
              keyMap.set(keyName, {key: keyName, val: kv.val, tx: enrichedTx.tx_hash, vout: i, _kstatus, _priority: priority});
            }
          }
        }
      }
      setOwnedKeys([...keyMap.values()]);
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
  const label = wallet.name || '';
  const handleDelete = ()=>{
    if (window.confirm(`Delete wallet "${label}"?\n\nMake sure you have backed up the mnemonic!`))
      onDelete();
  };
  return (
    <div>
      <h2>{label}</h2>
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
          onClick={()=>setSubscreen('inscribe')}
          disabled={!client || !allAddrs.length}
          style={{fontWeight: subscreen=='inscribe' ? 'bold' : 'normal'}}
        >Inscribe</button>
        <button
          onClick={()=>setSubscreen('wallet-settings')}
          style={{marginLeft: 'auto', fontWeight: subscreen=='wallet-settings' ? 'bold' : 'normal'}}
        >⚙ Settings</button>
      </div>

      {subscreen=='overview' && (
        <div style={{marginTop: 16}}>
          {ownedKeys.length > 0 && (<>
            <h3>Names</h3>
            <ul style={{marginTop: 8, paddingLeft: 0, listStyle: 'none'}}>
              {ownedKeys.map((k, i)=>(
                <li key={i}
                  onClick={()=>onSelectKey({...k, _tx: transactions.find(t=>t.tx_hash==k.tx), _walletAddrs: new Set(allAddrs.map(a=>a.address))})}
                  style={{fontSize: 13, marginTop: 4, cursor: 'pointer', padding: '4px 0',
                    borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', gap: 8}}
                >
                  <span style={{fontFamily: 'monospace', color: k._kstatus=='confirmed'?'green':k._kstatus=='receiving'?'#f90':'#c00'}}>{k.key}</span>
                  <span style={{color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220}}>
                    {trunc(json(k.val), 40)}
                  </span>
                </li>
              ))}
            </ul>
          </>)}
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
                    onClick={()=>onSelectTx({tx, conf, walletAddrs: new Set(allAddrs.map(a=>a.address))})}
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
      {subscreen=='receive' && receiveAddress && (
        <ReceiveScreen
          address={receiveAddress}
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
      {subscreen=='inscribe' && client && allAddrs.length>0 && (
        <InscribeScreen
          client={client}
          addrs={allAddrs}
          changeAddrInfo={changeAddrInfo}
          network={network}
          conf={conf}
          onSent={()=>{ setSubscreen('overview'); fetchData(client); }}
        />
      )}
      {subscreen=='wallet-settings' && (
        <WalletSettingsSubscreen
          wallet={wallet}
          conf={conf}
          onUpdate={onUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// Wallet Settings Subscreen
function WalletSettingsSubscreen({wallet, conf, onUpdate, onDelete}){
  const [revealed, setRevealed] = useState(false);
  const [name, setName] = useState(wallet.name||'');
  const hasPassphrase = !!wallet.passphrase;
  const derivPath = wallet.derivPath || defaultDerivPath(conf);
  return (
    <div style={{marginTop: 16, maxWidth: 480}}>
      <h3>Wallet Settings</h3>
      <div style={{marginTop: 12}}>
        <label style={{color: '#666'}}>Name</label>
        <input
          value={name}
          onChange={e=>setName(e.target.value)}
          onBlur={()=>onUpdate({name: name.trim()})}
          style={{display: 'block', width: '100%', marginTop: 4, boxSizing: 'border-box'}}
        />
      </div>
      <table style={{marginTop: 12, borderCollapse: 'collapse', width: '100%'}}>
        <tbody>
          <tr>
            <td style={{padding: '5px 12px 5px 0', color: '#666', whiteSpace: 'nowrap'}}>Network</td>
            <td style={{padding: '5px 0'}}>{conf.name}</td>
          </tr>
          <tr>
            <td style={{padding: '5px 12px 5px 0', color: '#666', whiteSpace: 'nowrap'}}>Derivation path</td>
            <td style={{padding: '5px 0', fontFamily: 'monospace', fontSize: 13}}>{derivPath}</td>
          </tr>
          <tr>
            <td style={{padding: '5px 12px 5px 0', color: '#666', whiteSpace: 'nowrap'}}>Passphrase</td>
            <td style={{padding: '5px 0'}}>{hasPassphrase ? 'Yes' : 'No'}</td>
          </tr>
        </tbody>
      </table>
      <div style={{marginTop: 16}}>
        <label style={{fontWeight: 'bold', fontSize: 13}}>Mnemonic</label>
        <input
          type={revealed ? 'text' : 'password'}
          readOnly
          value={wallet.mnemonic}
          style={{display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace',
            fontSize: 13, boxSizing: 'border-box', background: '#f4f4f4', border: '1px solid #ccc',
            borderRadius: 4, padding: 8}}
        />
      </div>
      {hasPassphrase && (
        <div style={{marginTop: 10}}>
          <label style={{fontWeight: 'bold', fontSize: 13}}>Passphrase</label>
          <input
            type={revealed ? 'text' : 'password'}
            readOnly
            value={wallet.passphrase}
            style={{display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace',
              fontSize: 13, boxSizing: 'border-box', background: '#f4f4f4', border: '1px solid #ccc',
              borderRadius: 4, padding: 8}}
          />
        </div>
      )}
      <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 20}}>
        <button
          onClick={onDelete}
          style={{color: '#c00', border: '1px solid #c00', background: 'transparent'}}
        >Delete Wallet</button>
        <button onClick={()=>setRevealed(r=>!r)}>
          {revealed ? 'Hide backup' : 'Backup Wallet'}
        </button>
      </div>
    </div>
  );
}

// Receive Screen
function ReceiveScreen({address, symbol}){
  const [copied, setCopied] = useState(false);
  const handleCopy = ()=>{
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(()=>setCopied(false), 2000);
  };
  return (
    <div style={{marginTop: 16, maxWidth: 480}}>
      <h3>Receive {symbol}</h3>
      <p style={{color: '#666', fontSize: 13, marginTop: 4}}>
        Fresh address — a new one will appear after it receives funds.
      </p>
      <div
        onClick={handleCopy}
        style={{
          fontFamily: 'monospace',
          background: '#f4f4f4',
          border: '1px solid #ccc',
          borderRadius: 4,
          padding: 12,
          marginTop: 8,
          wordBreak: 'break-all',
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        {address}
      </div>
      {copied && (
        <div style={{marginTop: 8, color: 'green', fontSize: 13}}>Copied to clipboard</div>
      )}
    </div>
  );
}

// Key Detail Screen
function KeyDetailScreen({keyData, conf, onViewTx, onTransfer, onEdit}){
  const tx = keyData._tx;
  const date = tx?.timestamp ? new Date(tx.timestamp*1000).toLocaleString() : null;
  const statusColor = keyData._kstatus=='confirmed'?'green':keyData._kstatus=='receiving'?'#f90':'#c00';
  const statusLabel = keyData._kstatus=='confirmed'?'Confirmed':keyData._kstatus=='receiving'?'Unconfirmed':'Spent';
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const startEdit = ()=>{ setEditVal(json(keyData.val)); setEditing(true); };
  const isSpent = keyData._kstatus=='spent';
  return (
    <div style={{marginTop: 16, maxWidth: 600}}>
      <h3>Name <span style={{color: statusColor, fontFamily: 'monospace'}}>{keyData.key}</span></h3>
      <div style={{marginTop: 12}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <strong>Value:</strong>
          {!editing && !isSpent && <button onClick={startEdit} style={{fontSize: 12}}>Edit</button>}
        </div>
        {editing ? (<>
          <textarea
            rows={5}
            value={editVal}
            onChange={e=>setEditVal(e.target.value)}
            style={{display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace',
              fontSize: 13, boxSizing: 'border-box'}}
          />
          <div style={{display: 'flex', gap: 8, marginTop: 6}}>
            <button onClick={()=>{ onEdit(editVal); setEditing(false); }}>Save</button>
            <button onClick={()=>setEditing(false)}>Cancel</button>
          </div>
        </>) : (
          <div style={{fontFamily: 'monospace', wordBreak: 'break-all', whiteSpace: 'pre-wrap', marginTop: 2}}>{json(keyData.val)}</div>
        )}
      </div>
      {tx && (<>
        <div style={{marginTop: 12}}>
          <strong>Date:</strong>{' '}
          {date || <span style={{color: '#f90'}}>unconfirmed</span>}
          {' '}<span style={{color: statusColor, fontSize: 13}}>({statusLabel})</span>
        </div>
        <div style={{marginTop: 8, display: 'flex', gap: 8}}>
          <button onClick={()=>onViewTx(tx)}>View Transaction</button>
          <button onClick={onTransfer} disabled={isSpent}>Transfer</button>
        </div>
      </>)}
    </div>
  );
}

// Name Transfer Screen
function NameTransferScreen({wallet, networks, keyData, onSent}){
  const conf = networks[wallet.network] || Object.values(networks)[0];
  const network = conf.network;
  const [toAddress, setToAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [client, setClient] = useState(null);
  const [addrs, setAddrs] = useState([]);
  const [changeAddrInfo, setChangeAddrInfo] = useState(null);
  const [connErr, setConnErr] = useState(false);

  useEffect(()=>{
    const cl = Electrum_connect(conf.electrum);
    (async()=>{
      try {
        await cl.connect('lif-coin-wallet', '1.4');
        setClient(cl);
        const root = getRoot(wallet.mnemonic, network, wallet.passphrase||'');
        const accountPath = wallet.derivPath || defaultDerivPath(conf);
        const [extRes, chgRes] = await Promise.all([
          scanAddresses(cl, root, accountPath, network, 0),
          scanAddresses(cl, root, accountPath, network, 1),
        ]);
        setAddrs([...extRes.used, ...chgRes.used]);
        setChangeAddrInfo(deriveAddrAt(root, accountPath, network, 1, chgRes.nextIndex));
      } catch(e){
        console.error('NameTransfer connect error:', e);
        setConnErr(true);
      }
    })();
    return ()=>{ try { cl.close(); } catch {} };
  }, []);

  const handleTransfer = async()=>{
    if (!toAddress.trim())
      return alert('Enter recipient address');
    if (!client)
      return alert('Not connected');
    const nameVout = keyData._tx._vtx.vout[keyData.vout];
    const nameValue = Math.round(nameVout.value*1e8);
    const nameAddr = nameVout.scriptPubKey?.address || nameVout.scriptPubKey?.addresses?.[0];
    const nameAddrInfo = addrs.find(a=>a.address==nameAddr);
    if (!nameAddrInfo)
      return alert('Name UTXO address not found in wallet');
    const fee = 2000;
    const psbt = new bitcoin.Psbt({network});
    psbt.addInput({
      hash: keyData.tx,
      index: keyData.vout,
      witnessUtxo: {
        value: BigInt(nameValue),
        script: bitcoin.address.toOutputScript(nameAddr, network),
      },
    });
    const signers = [nameAddrInfo];
    let extraTotal = 0;
    if (nameValue < fee){
      let allUTXOs = [];
      try {
        const lists = await Promise.all(
          addrs.map(async(addrInfo)=>{
            const sh = getScriptHash(addrInfo.address, network);
            const utxos = await client.blockchain_scripthash_listunspent(sh);
            return utxos.map(u=>({...u, addrInfo}));
          })
        );
        allUTXOs = lists.flat().filter(u=>!(u.tx_hash==keyData.tx && u.tx_pos==keyData.vout));
      } catch(err){
        return alert('Failed to fetch UTXOs');
      }
      allUTXOs.sort((a, b)=>b.value-a.value);
      for (const utxo of allUTXOs){
        psbt.addInput({
          hash: utxo.tx_hash,
          index: utxo.tx_pos,
          witnessUtxo: {
            value: BigInt(utxo.value),
            script: bitcoin.address.toOutputScript(utxo.addrInfo.address, network),
          },
        });
        signers.push(utxo.addrInfo);
        extraTotal += utxo.value;
        if (extraTotal >= fee)
          break;
      }
      if (extraTotal < fee)
        return alert('Insufficient balance to cover fees');
      psbt.addOutput({address: toAddress.trim(), value: BigInt(nameValue)});
      const change = extraTotal-fee;
      if (change>546)
        psbt.addOutput({address: changeAddrInfo.address, value: BigInt(change)});
    } else {
      psbt.addOutput({address: toAddress.trim(), value: BigInt(nameValue-fee)});
    }
    for (let i=0; i<signers.length; i++)
      psbt.signInput(i, signers[i].keyPair);
    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();
    setSending(true);
    try {
      const txid = await client.blockchain_transaction_broadcast(txHex);
      const explorerLink = conf.explorer_tx ? `\n${conf.explorer_tx}${txid}` : '';
      alert(`Name transferred!\nTXID: ${txid}${explorerLink}`);
      onSent?.();
    } catch(err){
      alert('Broadcast failed: '+err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{marginTop: 16, maxWidth: 400}}>
      <h3>Transfer Name</h3>
      <div style={{marginTop: 8, color: '#666', fontSize: 13}}>
        Transferring: <span style={{fontFamily: 'monospace'}}>{keyData.key}</span>
      </div>
      {connErr && <p style={{color: '#c00'}}>Connection error</p>}
      <input
        placeholder="Recipient address"
        value={toAddress}
        onChange={e=>setToAddress(e.target.value)}
        style={{display: 'block', width: '100%', marginTop: 12, boxSizing: 'border-box'}}
      />
      <button onClick={handleTransfer} disabled={sending||!client} style={{marginTop: 8}}>
        {sending ? 'Transferring…' : 'Transfer'}
      </button>
    </div>
  );
}

// Name Edit Screen
function NameEditScreen({wallet, networks, keyData, onSent}){
  const conf = networks[wallet.network] || Object.values(networks)[0];
  const network = conf.network;
  const [sending, setSending] = useState(false);
  const [client, setClient] = useState(null);
  const [addrs, setAddrs] = useState([]);
  const [changeAddrInfo, setChangeAddrInfo] = useState(null);
  const [connErr, setConnErr] = useState(false);

  useEffect(()=>{
    const cl = Electrum_connect(conf.electrum);
    (async()=>{
      try {
        await cl.connect('lif-coin-wallet', '1.4');
        setClient(cl);
        const root = getRoot(wallet.mnemonic, network, wallet.passphrase||'');
        const accountPath = wallet.derivPath || defaultDerivPath(conf);
        const [extRes, chgRes] = await Promise.all([
          scanAddresses(cl, root, accountPath, network, 0),
          scanAddresses(cl, root, accountPath, network, 1),
        ]);
        setAddrs([...extRes.used, ...chgRes.used]);
        setChangeAddrInfo(deriveAddrAt(root, accountPath, network, 1, chgRes.nextIndex));
      } catch(e){
        console.error('NameEdit connect error:', e);
        setConnErr(true);
      }
    })();
    return ()=>{ try { cl.close(); } catch {} };
  }, []);

  const handleSave = async()=>{
    if (!client)
      return alert('Not connected');
    const nameVout = keyData._tx._vtx.vout[keyData.vout];
    const nameValue = Math.round(nameVout.value*1e8);
    const nameAddr = nameVout.scriptPubKey?.address || nameVout.scriptPubKey?.addresses?.[0];
    const nameAddrInfo = addrs.find(a=>a.address==nameAddr);
    if (!nameAddrInfo)
      return alert('Name UTXO address not found in wallet');
    const fee = 2000;
    const dest = changeAddrInfo.address;
    const inscriptionScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_RETURN,
      Buffer.from('lif'),
      Buffer.from('key'),
      Buffer.from(keyData.key),
      Buffer.from('val'),
      Buffer.from(keyData._editVal),
    ]);
    const psbt = new bitcoin.Psbt({network});
    psbt.addInput({
      hash: keyData.tx,
      index: keyData.vout,
      witnessUtxo: {
        value: BigInt(nameValue),
        script: bitcoin.address.toOutputScript(nameAddr, network),
      },
    });
    const signers = [nameAddrInfo];
    let extraTotal = 0;
    if (nameValue < fee){
      let allUTXOs = [];
      try {
        const lists = await Promise.all(
          addrs.map(async(addrInfo)=>{
            const sh = getScriptHash(addrInfo.address, network);
            const utxos = await client.blockchain_scripthash_listunspent(sh);
            return utxos.map(u=>({...u, addrInfo}));
          })
        );
        allUTXOs = lists.flat().filter(u=>!(u.tx_hash==keyData.tx && u.tx_pos==keyData.vout));
      } catch(err){
        return alert('Failed to fetch UTXOs');
      }
      allUTXOs.sort((a, b)=>b.value-a.value);
      for (const utxo of allUTXOs){
        psbt.addInput({
          hash: utxo.tx_hash,
          index: utxo.tx_pos,
          witnessUtxo: {
            value: BigInt(utxo.value),
            script: bitcoin.address.toOutputScript(utxo.addrInfo.address, network),
          },
        });
        signers.push(utxo.addrInfo);
        extraTotal += utxo.value;
        if (extraTotal >= fee)
          break;
      }
      if (extraTotal < fee)
        return alert('Insufficient balance to cover fees');
      psbt.addOutput({script: inscriptionScript, value: 0n});
      psbt.addOutput({address: dest, value: BigInt(nameValue)});
      const change = extraTotal-fee;
      if (change>546)
        psbt.addOutput({address: changeAddrInfo.address, value: BigInt(change)});
    } else {
      psbt.addOutput({script: inscriptionScript, value: 0n});
      psbt.addOutput({address: dest, value: BigInt(nameValue-fee)});
    }
    for (let i=0; i<signers.length; i++)
      psbt.signInput(i, signers[i].keyPair);
    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();
    setSending(true);
    try {
      const txid = await client.blockchain_transaction_broadcast(txHex);
      const explorerLink = conf.explorer_tx ? `\n${conf.explorer_tx}${txid}` : '';
      alert(`Name updated!\nTXID: ${txid}${explorerLink}`);
      onSent?.();
    } catch(err){
      alert('Broadcast failed: '+err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{marginTop: 16, maxWidth: 400}}>
      <h3>Edit Name</h3>
      <div style={{marginTop: 8, color: '#666', fontSize: 13}}>
        Name: <span style={{fontFamily: 'monospace'}}>{keyData.key}</span>
      </div>
      <div style={{marginTop: 8, color: '#666', fontSize: 13}}>
        New value: <span style={{fontFamily: 'monospace'}}>{keyData._editVal}</span>
      </div>
      {connErr && <p style={{color: '#c00'}}>Connection error</p>}
      <button onClick={handleSave} disabled={sending||!client} style={{marginTop: 12}}>
        {sending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// Tx Detail Screen
function TxDetailScreen({tx, conf, walletAddrs, walletName}){
  const date = tx.timestamp ? new Date(tx.timestamp*1000).toLocaleString() : null;
  const positive = tx.amount>=0;
  const symbol = conf.symbol||'BTC';
  const voutAddr = (vout)=>vout.scriptPubKey?.address || vout.scriptPubKey?.addresses?.[0] || '?';
  return (
    <div style={{marginTop: 16, maxWidth: 600}}>
      <h3>{walletName} transaction</h3>
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
          value: BigInt(utxo.value),
          script: bitcoin.address.toOutputScript(utxo.addrInfo.address, network),
        },
      });
    }
    psbt.addOutput({address: toAddress, value: BigInt(amountValue)});
    const change = total-amountValue-fee;
    if (change>546)
      psbt.addOutput({address: changeAddrInfo.address, value: BigInt(change)});
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

// Inscribe Screen
function InscribeScreen({client, addrs, changeAddrInfo, network, conf, onSent}){
  const [inscKey, setInscKey] = useState('');
  const [inscVal, setInscVal] = useState('');
  const [sending, setSending] = useState(false);
  const [nameStatus, setNameStatus] = useState(null); // null | 'checking' | 'available' | 'taken'
  const [valError, setValError] = useState(false);

  useEffect(()=>{
    const key = inscKey.trim();
    if (!key || !client){
      setNameStatus(null);
      return;
    }
    setNameStatus('checking');
    const timer = setTimeout(()=>{
      (async()=>{
        try {
          let kv = await client.request('blockchain.lif_kv.get', [key]);
          if (kv===undefined) // this electrumx client returns undefined for error responses
            setNameStatus('available');
          else
            setNameStatus('taken');
        } catch(e){
          setNameStatus('error');
        }
      })();
    }, 500);
    return ()=>clearTimeout(timer);
  }, [inscKey, client]);
  const handleInscribe = async()=>{
    if (!inscKey.trim())
      return alert('Key is required');
    if (!inscVal.trim())
      return alert('Value is required');
    const inscriptionScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_RETURN,
      Buffer.from('lif'),
      Buffer.from('key'),
      Buffer.from(inscKey.trim()),
      Buffer.from('val'),
      Buffer.from(inscVal.trim()),
    ]);
    let allUTXOs = [];
    try {
      const lists = await Promise.all(
        addrs.map(async(addrInfo)=>{
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
    allUTXOs.sort((a, b)=>b.value-a.value);
    const fee = 2000;
    const selected = [];
    let total = 0;
    for (const utxo of allUTXOs){
      selected.push(utxo);
      total += utxo.value;
      if (total >= fee)
        break;
    }
    if (total < fee)
      return alert('Insufficient balance to cover fee');
    const psbt = new bitcoin.Psbt({network});
    for (const utxo of selected){
      psbt.addInput({
        hash: utxo.tx_hash,
        index: utxo.tx_pos,
        witnessUtxo: {
          value: BigInt(utxo.value),
          script: bitcoin.address.toOutputScript(utxo.addrInfo.address, network),
        },
      });
    }
    psbt.addOutput({script: inscriptionScript, value: 0n});
    psbt.addOutput({address: changeAddrInfo.address, value: BigInt(total-fee)});
    for (let i=0; i<selected.length; i++)
      psbt.signInput(i, selected[i].addrInfo.keyPair);
    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();
    setSending(true);
    try {
      const txid = await client.blockchain_transaction_broadcast(txHex);
      alert(`Inscription sent!\nTXID: ${txid}`);
      setInscKey('');
      setInscVal('');
      onSent?.();
    } catch(err){
      alert('Broadcast failed: '+err.message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div style={{marginTop: 16, maxWidth: 480}}>
      <h3>Inscribe new name</h3>
      <p style={{fontSize: 13, color: '#666', marginTop: 4}}>
        Writes a LIF key/value inscription to the blockchain.
      </p>
      <div style={{marginTop: 12}}>
        <label>Name:</label>
        <input
          placeholder="e.g. dns/jungo"
          value={inscKey}
          onChange={e=>setInscKey(e.target.value)}
          style={{display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace',
            fontSize: 13, boxSizing: 'border-box'}}
        />
        {nameStatus=='checking' && <div style={{fontSize: 12, color: '#aaa', marginTop: 3}}>Checking…</div>}
        {nameStatus=='available' && <div style={{fontSize: 12, color: 'green', marginTop: 3}}>Available</div>}
        {nameStatus=='taken' && <div style={{fontSize: 12, color: '#c00', marginTop: 3}}>Already inscribed</div>}
      </div>
      <div style={{marginTop: 12}}>
        <label>Value:</label>
        <textarea
          rows={5}
          placeholder={'{"site": "lif:git/..."}'}
          value={inscVal}
          onChange={e=>{ setInscVal(e.target.value); try { JSON.parse(e.target.value); setValError(false); } catch { setValError(true); } }}
          style={{display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace',
            fontSize: 13, boxSizing: 'border-box'}}
        />
        {valError && <div style={{fontSize: 12, color: '#c00', marginTop: 3}}>Invalid JSON</div>}
      </div>
      <button onClick={handleInscribe} disabled={sending||nameStatus=='taken'||valError} style={{marginTop: 12}}>
        {sending ? 'Inscribing…' : 'Inscribe'}
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
