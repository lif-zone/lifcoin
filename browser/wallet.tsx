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
  let protocol = u.protocol.slice(0, -1); // 'wss:' -> 'wss'
  let port = u.port || (protocol=='wss' ? '443' : protocol=='ws' ? '80' : '');
  let host = u.hostname;
  let path = u.pathname;
  return new ElectrumClient(host, port+path, protocol);
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

function deriveWallet(mnemonic, networkKey, networks){
  const conf = networks[networkKey];
  const network = conf.network;
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, network);
  const child = root.derivePath(`m/84'/${conf.coin_type}'/0'/0/0`);
  const {address} = bitcoin.payments.p2wpkh({pubkey: Buffer(child.publicKey), network});
  const keyPair = ecpair.fromPrivateKey(child.privateKey, {network});
  return {address, keyPair, network, conf};
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
      return [{id: '1', name: '', network: oldNetwork, mnemonic: oldMnemonic}];
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
    const updated = wallets.filter(w=>w.id !== id);
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
        <h1 style={{cursor: 'pointer', fontSize: 24, margin: 0, display: 'flex', alignItems: 'center', gap: 8}} onClick={goHome}>
          <img src={import.meta.resolve('./bright.ico')} style={{width: 32, height: 32}} />
          Bright Wallet
        </h1>
        {(screen=='home' || screen=='settings') &&
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
  const derived = useMemo(()=>{
    try { return deriveWallet(wallet.mnemonic, wallet.network, networks); }
    catch { return null; }
  }, [wallet.id, wallet.network]);

  useEffect(()=>{
    if (!derived)
      return;
    const {address, network, conf} = derived;
    let cl;
    (async ()=>{
      cl = Electrum_connect(conf.electrum);
      try {
        await cl.connect('lif-coin-wallet', '1.4');
        const sh = getScriptHash(address, network);
        const [bal, hist] = await Promise.all([
          cl.blockchain_scripthash_getBalance(sh),
          cl.blockchain_scripthash_getHistory(sh),
          cl.blockchain_scripthash_listunspent(sh),
        ]);
        setBalance(bal.confirmed + bal.unconfirmed);
        setTxCount(hist.length);
      } catch(e){
        console.error('WalletCard fetch error:', e);
        setConnErr(true);
      } finally {
        try { cl?.close(); } catch {}
      }
    })();
  }, [wallet.id, wallet.network, conf.electrum]);

  if (!derived)
    return (
    <div style={{...cardStyle, color: 'red'}} onClick={onClick}>
      <p>Invalid wallet</p>
    </div>
  );

  const {address} = derived;
  const label = wallet.name || (address.slice(0, 10) + '...');
  const symbol = conf.symbol || 'BTC';
  return (
    <div style={cardStyle} onClick={onClick}>
      <div style={{fontWeight: 'bold', fontSize: 15, wordBreak: 'break-all'}}>{label}</div>
      <div style={{fontSize: 12, color: '#888', marginTop: 2}}>{conf.name}</div>
      <div style={{fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 4}}>
        {address.slice(0, 22)}...
      </div>
      <div style={{marginTop: 10}}>
        {connErr ? (
          <span style={{color: '#c00', fontSize: 12}}>Connection error</span>
        ) : balance===null ? (
          <span style={{color: '#aaa', fontSize: 12}}>Loading…</span>
        ) : (
          <>
            <div style={{fontWeight: 'bold'}}>
              {(balance / 1e8).toFixed(8)} {symbol}
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
  const [mode, setMode] = useState('generate'); // 'generate' | 'restore'
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const handleAdd = ()=>{
    setError('');
    let mnemonic;
    if (mode=='generate'){
      mnemonic = bip39.generateMnemonic();
    } else {
      const cleaned = mnemonicInput.trim().toLowerCase();
      if (!bip39.validateMnemonic(cleaned)){
        setError('Invalid mnemonic phrase');
        return;
      }
      mnemonic = cleaned;
    }
    try {
      deriveWallet(mnemonic, networkKey, networks);
    } catch(e){
      setError('Failed to derive wallet: ' + e.message);
      return;
    }
    onAdd({id: Date.now().toString(), name: name.trim(), network: networkKey, mnemonic});
  };
  return (
    <div style={{maxWidth: 480}}>
      <button onClick={onCancel}>← Back</button>
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
        <label>Wallet key:</label>
        <div style={{display: 'flex', gap: 8, marginTop: 4}}>
          <button
            onClick={()=>setMode('generate')}
            style={{fontWeight: mode=='generate' ? 'bold' : 'normal'}}
          >Generate new</button>
          <button
            onClick={()=>setMode('restore')}
            style={{fontWeight: mode=='restore' ? 'bold' : 'normal'}}
          >Restore from mnemonic</button>
        </div>
        {mode=='restore' && (
          <textarea
            rows={4}
            placeholder="Enter your 12/24 words (space separated)"
            value={mnemonicInput}
            onChange={e=>setMnemonicInput(e.target.value)}
            style={{display: 'block', width: '100%', marginTop: 8, boxSizing: 'border-box'}}
          />
        )}
        {mode=='generate' && (
          <p style={{color: '#666', fontSize: 13, marginTop: 8}}>
            A new mnemonic will be generated. Back it up after adding!
          </p>
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
  const [client, setClient] = useState(null);
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [subscreen, setSubscreen] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const derived = useMemo(()=>{
    try { return deriveWallet(wallet.mnemonic, wallet.network, networks); }
    catch { return null; }
  }, [wallet.id, wallet.network]);
  const fetchData = async (cl, address, network)=>{
    setLoading(true);
    try {
      const sh = getScriptHash(address, network);
      const [bal, hist] = await Promise.all([
        cl.blockchain_scripthash_getBalance(sh),
        cl.blockchain_scripthash_getHistory(sh),
      ]);
      setBalance(bal.confirmed + bal.unconfirmed);
      setTransactions(hist);
    } catch(e){
      console.error('fetchData error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(()=>{
    if (!derived)
      return;
    const {address, network, conf} = derived;
    const cl = Electrum_connect(conf.electrum);
    (async()=>{
      try {
        await cl.connect('lif-coin-wallet', '1.4');
        setClient(cl);
        fetchData(cl, address, network);
      } catch(e){
        console.error('Connect error:', e);
        setConnErr(true);
      }
    })();
    return ()=>cl.close();
  }, [wallet.id, wallet.network]);
  if (!derived){
    return (
      <div>
        <button onClick={onBack}>← Back</button>
        <p style={{color: 'red', marginTop: 8}}>Invalid wallet data</p>
      </div>
    );
  }
  const {address, keyPair, network, conf} = derived;
  const symbol = conf.symbol || 'BTC';
  const label = wallet.name || address;
  const handleDelete = ()=>{
    if (window.confirm(`Delete wallet "${label}"?\n\nMake sure you have backed up the mnemonic!`))
      onDelete();
  };
  return (
    <div>
      <button onClick={onBack}>← Back</button>
      <h2 style={{marginTop: 8}}>{label}</h2>
      <div style={{color: '#888', fontSize: 13}}>{conf.name}</div>

      {connErr && (
        <p style={{color: '#c00', marginTop: 8}}>
          Failed to connect to Electrum server ({conf.electrum})
        </p>
      )}

      <div style={{marginTop: 10}}>
        <strong>Address:</strong>
        <div style={{fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 14, marginTop: 2}}>
          {address}
        </div>
      </div>
      <div style={{marginTop: 6}}>
        <strong>Balance:</strong>{' '}
        {balance===null
          ? (connErr ? 'unavailable' : 'loading…')
          : `${(balance / 1e8).toFixed(8)} ${symbol}`
        }
      </div>

      <div style={{display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center'}}>
        <button
          onClick={()=>setSubscreen('overview')}
          style={{fontWeight: subscreen=='overview' ? 'bold' : 'normal'}}
        >Overview</button>
        <button
          onClick={()=>setSubscreen('send')}
          disabled={!client}
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
            <ul style={{marginTop: 8, paddingLeft: 16}}>
              {transactions.map((tx, i)=>(
                <li key={i} style={{fontFamily: 'monospace', fontSize: 13, marginTop: 4}}>
                  {conf.explorer_tx ? (
                    <a href={conf.explorer_tx + tx.tx_hash} target="_blank" rel="noreferrer">
                      {tx.tx_hash.slice(0, 24)}…
                    </a>
                  ) : (
                    <span>{tx.tx_hash.slice(0, 24)}…</span>
                  )}
                  {' '}
                  <span style={{color: '#888'}}>
                    {tx.height > 0 ? `block ${tx.height}` : 'unconfirmed'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {client && (
            <button style={{marginTop: 10}} onClick={()=>fetchData(client, address, network)}>
              Refresh
            </button>
          )}
        </div>
      )}

      {subscreen=='send' && client && (
        <SendScreen
          client={client}
          privateKey={keyPair}
          address={address}
          network={network}
          conf={conf}
          getScriptHash={(addr)=>getScriptHash(addr, network)}
          onSent={()=>{ setSubscreen('overview'); fetchData(client, address, network); }}
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

// Send Screen
function SendScreen({client, privateKey, address, network, conf, getScriptHash, onSent}){
  const [toAddress, setToAddress] = useState('');
  const [amountSat, setAmountSat] = useState('');
  const [sending, setSending] = useState(false);
  const handleSend = async ()=>{
    if (!client || !privateKey || !address)
      return;
    const amountValue = parseInt(amountSat, 10);
    if (isNaN(amountValue) || amountValue <= 0)
      return alert('Invalid amount');
    const scripthash = getScriptHash(address);
    let utxos;
    try {
      utxos = await client.blockchain_scripthash_listunspent(scripthash);
    } catch(err){
      return alert('Failed to fetch UTXOs');
    }
    if (!utxos?.length)
      return alert('No funds available');
    const utxo = utxos[0];
    const fee = 2000;
    if (utxo.value < amountValue + fee)
      return alert('Insufficient balance');
    const psbt = new bitcoin.Psbt({network});
    psbt.addInput({
      hash: utxo.tx_hash,
      index: utxo.tx_pos,
      witnessUtxo: {value: utxo.value, script: bitcoin.address.toOutputScript(address, network)},
    });
    psbt.addOutput({address: toAddress, value: amountValue});
    const change = utxo.value - amountValue - fee;
    if (change > 546)
      psbt.addOutput({address, value: change});
    psbt.signInput(0, privateKey);
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
      alert('Broadcast failed: ' + err.message);
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
      <button onClick={onBack}>← Back</button>
      <h2 style={{marginTop: 8}}>Settings</h2>
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
