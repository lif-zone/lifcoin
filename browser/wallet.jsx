// wallet.jsx - bright wallet - BTC, LIF, multi-wallet support
import React, {useState, useEffect, useMemo} from 'react';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import {DEFAULT_NETWORKS, saveServers, loadServers,
  saveWallets, loadWallets,
  getRoot, getNetworks,
  deriveWallet, deriveAddrAt, defaultDerivPath,
  calcFee, tx_send_build,
  fetchWalletData,
  kv_get, tx_send, kv_tx_send, kv_tx_edit, kv_tx_add, tx_broadcast,
} from './wallet_db.js';

function json(o){
  return JSON.stringify(o);
}
function trunc(s, len){
  return s.length>len ? s.slice(0, len)+'…' : s;
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
  const [servers, setServers] = useState(loadServers);
  const networks = useMemo(()=>getNetworks(servers), [servers]);
  const [wallets, setWallets] = useState(
    ()=>loadWallets(getNetworks(loadServers())));
  const [screen, setScreen] = useState('home');
  const [activeWalletId, setActiveWalletId] = useState(null);
  const [selectedTxData, setSelectedTxData] = useState(null);
  const [selectedKeyData, setSelectedKeyData] = useState(null);
  useEffect(()=>{
    setWallets(ws=>ws.map(w=>({...w,
      conf: networks[w.network]||Object.values(networks)[0]})));
  }, [networks]);
  const addWallet = (wallet)=>{
    const updated = [...wallets,
      {...wallet, conf: networks[wallet.network]||Object.values(networks)[0]}];
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
          conf={activeWallet.conf}
          onViewTx={(tx)=>{ setSelectedTxData({tx, conf: activeWallet.conf, walletAddrs: selectedKeyData._walletAddrs}); setScreen('tx-detail'); }}
          onTransfer={()=>setScreen('name-transfer')}
          onEdit={(newVal)=>{ setSelectedKeyData(d=>({...d, _editVal: newVal})); setScreen('name-edit'); }}
        />
      )}
      {screen=='name-transfer' && selectedKeyData && activeWallet && (
        <NameTransferScreen
          wallet={activeWallet}
          keyData={selectedKeyData}
          onSent={()=>setScreen('wallet-detail')}
        />
      )}
      {screen=='name-edit' && selectedKeyData && activeWallet && (
        <NameEditScreen
          wallet={activeWallet}
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
function HomeScreen({wallets, onSelect, onAddNew}){
  return (
    <div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16}}>
        {wallets.map(wallet=>(
          <WalletCard
            key={wallet.id}
            wallet={wallet}
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
function WalletCard({wallet, onClick}){
  const conf = wallet.conf;
  const [balance, setBalance] = useState(wallet.balance ?? null);
  const [txCount, setTxCount] = useState(wallet.transactions?.length ?? null);
  const [keysOwned, setKeysOwned] = useState(wallet.ownedKeys?.length ?? 0);
  const [connErr, setConnErr] = useState(false);
  const derived = useMemo(()=>{
    try {
      getRoot(wallet.mnemonic, conf.network, wallet.passphrase||'');
      return true;
    } catch { return false; }
  }, [wallet.id, wallet.network]);

  useEffect(()=>{
    if (!derived) return;
    (async()=>{
      try {
        const data = await fetchWalletData(wallet);
        setBalance(data.balance);
        setTxCount(data.transactions.length);
        setKeysOwned(data.ownedKeys.length);
      } catch(e){
        console.error('WalletCard fetch error:', e);
        setConnErr(true);
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

  const symbol = conf.symbol;
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
              <Amt sat={balance} symbol={symbol} signed />
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
  const [derivPath, setDerivPath] = useState(
    ()=>defaultDerivPath(networks['mainnet']));
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
    onAdd({id: Date.now().toString(), name: name.trim(), network: networkKey,
      mnemonic, passphrase: pp, derivPath: dp});
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
function WalletDetailScreen({wallet, onDelete, onUpdate, onBack, onSelectTx,
  onSelectKey})
{
  const conf = wallet.conf;
  const [connected, setConnected] = useState(false);
  const [balance, setBalance] = useState(wallet.balance ?? null);
  const [transactions, setTransactions] = useState(wallet.transactions ?? []);
  const [ownedKeys, setOwnedKeys] = useState(wallet.ownedKeys ?? []);
  const [subscreen, setSubscreen] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const [receiveAddress, setReceiveAddress] =
    useState(wallet.receiveAddress ?? null);
  const [allAddrs, setAllAddrs] = useState(wallet.addrs ?? []);
  const applyData = (data)=>{
    setBalance(data.balance);
    setTransactions(data.transactions);
    setOwnedKeys(data.ownedKeys);
    setAllAddrs(data.addrs);
    setReceiveAddress(data.receiveAddress);
  };

  useEffect(()=>{
    try {
      getRoot(wallet.mnemonic, network, wallet.passphrase||'');
    } catch(e){ return; }
    (async()=>{
      try {
        setLoading(true);
        applyData(await fetchWalletData(wallet));
        setConnected(true);
      } catch(e){
        console.error('Connect error:', e);
        setConnErr(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [wallet.id, wallet.network]);

  const symbol = conf.symbol;
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
          : <Amt sat={balance} symbol={symbol} signed />
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
          disabled={!allAddrs.length}
          style={{fontWeight: subscreen=='send' ? 'bold' : 'normal'}}
        >Send</button>
        <button
          onClick={()=>setSubscreen('inscribe')}
          disabled={!allAddrs.length}
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
                    <Amt sat={tx.amount} symbol={symbol} signed />
                  </li>
                );
              })}
            </ul>
          )}
          <button style={{marginTop: 10}} onClick={async()=>{
            setLoading(true);
            try { applyData(await fetchWalletData(wallet)); }
            catch(e){ console.error('Refresh error:', e); }
            finally { setLoading(false); }
          }}>
            Refresh
          </button>
        </div>
      )}
      {subscreen=='receive' && receiveAddress && (
        <ReceiveScreen
          address={receiveAddress}
          symbol={symbol}
        />
      )}
      {subscreen=='send' && allAddrs.length>0 && (
        <SendScreen
          wallet={wallet}
          onSent={async()=>{ setSubscreen('overview'); setLoading(true); try { applyData(await fetchWalletData(wallet)); } catch(e){} finally { setLoading(false); } }}
        />
      )}
      {subscreen=='inscribe' && allAddrs.length>0 && (
        <InscribeScreen
          wallet={wallet}
          onSent={async()=>{ setSubscreen('overview'); setLoading(true); try { applyData(await fetchWalletData(wallet)); } catch(e){} finally { setLoading(false); } }}
        />
      )}
      {subscreen=='wallet-settings' && (
        <WalletSettingsSubscreen
          wallet={wallet}
          onUpdate={onUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// Wallet Settings Subscreen
function WalletSettingsSubscreen({wallet, onUpdate, onDelete}){
  const conf = wallet.conf;
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
  const date = tx?.timestamp ? new Date(tx.timestamp*1000).toLocaleString()
    : null;
  const statusColor = keyData._kstatus=='confirmed' ? 'green' :
    keyData._kstatus=='receiving' ? '#f90' : '#c00';
  const statusLabel = keyData._kstatus=='confirmed' ? 'Confirmed' :
    keyData._kstatus=='receiving' ? 'Unconfirmed' : 'Spent';
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
function NameTransferScreen({wallet, keyData, onSent}){
  const conf = wallet.conf;
  const [toAddress, setToAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [feeRate, setFeeRate] = useState(wallet.feeRate||conf.fee_def);
  const [fee, setFee] = useState(()=>{
    try {
      const fr = wallet.feeRate||conf.fee_def;
      const addr = wallet.changeAddrInfo?.address||'';
      return kv_tx_send(wallet, keyData, addr, fr, fr, true).exactFee;
    } catch(e){ return wallet.feeRate||conf.fee_def; }
  });

  useEffect(()=>{
    try {
      const addr = wallet.changeAddrInfo?.address||'';
      const {exactFee} = kv_tx_send(wallet, keyData, addr, fee, feeRate, true);
      setFee(exactFee);
    } catch(e){}
  }, [feeRate]);

  const handleTransfer = async()=>{
    if (!toAddress.trim())
      return alert('Enter recipient address');
    setSending(true);
    try {
      const {exactFee, tx} = kv_tx_send(wallet, keyData,
        toAddress.trim(), fee, feeRate);
      const txid = tx.getId();
      await tx_broadcast(conf, tx);
      setFee(exactFee);
      const explorerLink = conf.explorer_tx?`\n${conf.explorer_tx}${txid}`:'';
      alert(`Name transferred!\nTXID: ${txid}${explorerLink}`);
      onSent?.();
    } catch(err){
      alert(err.message);
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
      <input
        placeholder="Recipient address"
        value={toAddress}
        onChange={e=>setToAddress(e.target.value)}
        style={{display: 'block', width: '100%', marginTop: 12, boxSizing: 'border-box'}}
      />
      <FeeField value={fee} onChange={setFee} conf={conf} />
      <button onClick={handleTransfer} disabled={sending} style={{marginTop: 8}}>
        {sending ? 'Transferring…' : 'Transfer'}
      </button>
    </div>
  );
}

// Name Edit Screen
function NameEditScreen({wallet, keyData, onSent}){
  const conf = wallet.conf;
  const [sending, setSending] = useState(false);
  const [feeRate, setFeeRate] = useState(wallet.feeRate||conf.fee_def);
  const [fee, setFee] = useState(()=>{
    try {
      const fr = wallet.feeRate||conf.fee_def;
      return kv_tx_edit(wallet, keyData, fr, fr, true).exactFee;
    } catch(e){ return wallet.feeRate||conf.fee_def; }
  });

  useEffect(()=>{
    try {
      const {exactFee} = kv_tx_edit(wallet, keyData, fee, feeRate, true);
      setFee(exactFee);
    } catch(e){}
  }, [feeRate]);

  const handleSave = async()=>{
    setSending(true);
    try {
      const {exactFee, tx} = kv_tx_edit(wallet, keyData, fee, feeRate);
      const txid = tx.getId();
      await tx_broadcast(conf, tx);
      setFee(exactFee);
      const explorerLink=conf.explorer_tx?`\n${conf.explorer_tx}${txid}`:'';
      alert(`Name updated!\nTXID: ${txid}${explorerLink}`);
      onSent?.();
    } catch(err){
      alert(err.message);
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
      <FeeField value={fee} onChange={setFee} conf={conf} />
      <button onClick={handleSave} disabled={sending} style={{marginTop: 12}}>
        {sending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// Tx Detail Screen
function TxDetailScreen({tx, conf, walletAddrs, walletName}){
  const date = tx.timestamp ? new Date(tx.timestamp*1000).toLocaleString()
    : null;
  const positive = tx.amount>=0;
  const symbol = conf.symbol;
  const voutAddr = (vout)=>vout.scriptPubKey?.address
    || vout.scriptPubKey?.addresses?.[0] || '?';
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
          <Amt sat={tx.amount} symbol={symbol} signed />
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
          const val = vin._prevVout ? Math.round(vin._prevVout.value*1e8)
            : null;
          const ours = walletAddrs.has(addr);
          return (
            <div key={i} style={{fontFamily: 'monospace', fontSize: 12, marginTop: 3,
              color: ours ? '#c00' : 'inherit'}}
            >
              {addr}{val!==null && <> <Amt sat={-val} symbol={symbol} signed /></>}{ours && ' ← yours'}
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
              {addr}: <Amt sat={val} symbol={symbol} signed />{ours && ' ← yours'}
            </div>
          );
        })}
      </>)}
    </div>
  );
}

function Amt({sat, symbol, signed}){
  const sign = signed ? (sat>0 ? '+' : sat<0 ? '-' : '') : '';
  const color = signed ? (sat>0 ? 'green' : sat<0 ? '#c00' : null) : null;
  const [int, dec] = (Math.abs(sat)/1e8).toFixed(8).split('.');
  const sig = dec.replace(/0+$/, '');
  const zeros = dec.slice(sig.length);
  return (
    <span style={{fontFamily: 'monospace', ...(color&&{color})}}>
      {sign}{int}
      {sig.length===0
        ? <span style={{color: '#aaa'}}>.{zeros}</span>
        : <>.{sig}{zeros && <span style={{color: '#aaa'}}>{zeros}</span>}</>
      }{symbol?' '+symbol:''}
    </span>
  );
}

function FeeField({value, onChange, conf}){
  const symbol = conf?.symbol;
  const [editing, setEditing] = useState(false);
  const [str, setStr] = useState((value/1e8).toFixed(8));
  useEffect(()=>{
    if (!editing)
      setStr((value/1e8).toFixed(8));
  }, [value, editing]);
  const commit = ()=>{
    const v = Math.max(1, Math.round(parseFloat(str)*1e8)||value);
    onChange(v);
    setEditing(false);
  };
  return (
    <div style={{marginTop: 8, fontSize: 13}}>
      <span style={{color: '#666'}}>Fee: </span>
      {editing ? (
        <>
          <input type="text" value={str} onChange={e=>setStr(e.target.value)}
            onBlur={commit} autoFocus style={{width: 120, fontFamily: 'monospace', fontSize: 13}} />
          {' '}{symbol}
        </>
      ) : (
        <span onClick={()=>{ setStr((value/1e8).toFixed(8)); setEditing(true); }}
          style={{cursor: 'pointer', borderBottom: '1px dotted #999'}}
        ><Amt sat={value} symbol={symbol} /></span>
      )}
    </div>
  );
}

// Send Screen
function SendScreen({wallet, onSent}){
  const {conf, utxos=[], changeAddrInfo} = wallet;
  const network = conf.network;
  const [toAddress, setToAddress] = useState('');
  const [amountSat, setAmountSat] = useState('');
  const [sending, setSending] = useState(false);
  const [feeRate, setFeeRate] = useState(wallet.feeRate||conf.fee_def);
  const [fee, setFee] = useState(()=>{
    if (!utxos.length)
      return 0;
    try {
      const u = utxos[0];
      const dummyAddr = changeAddrInfo?.address || u.addrInfo.address;
      const tx = tx_send_build(network, [u], dummyAddr, 1, dummyAddr,
        u.value, 0, true);
      return calcFee(wallet.feeRate||conf.fee_def, tx);
    } catch(e){ return 0; }
  });
  useEffect(()=>{
    if (!utxos.length)
      return;
    const dummyAddr = changeAddrInfo?.address || utxos[0].addrInfo.address;
    const amt = Math.round(parseFloat(amountSat)*1e8);
    const target = !isNaN(amt) && amt>0 ? amt : 1;
    const sorted = [...utxos].sort((a,b)=>b.value-a.value);
    let selected = [], total = 0;
    for (const u of sorted){
      selected.push(u); total+=u.value;
      if (total>=target)
        break;
    }
    try {
      const tx = tx_send_build(network, selected, dummyAddr,
        Math.min(target, total), dummyAddr, total, 0, true);
      setFee(calcFee(feeRate, tx));
    } catch(e){}
  }, [amountSat, feeRate, utxos]);
  const handleSend = async()=>{
    const amountValue = Math.round(parseFloat(amountSat)*1e8);
    if (isNaN(amountValue)||amountValue<=0)
      return alert('Invalid amount');
    setSending(true);
    try {
      const {exactFee, tx} = tx_send(wallet, toAddress, amountValue, fee, feeRate);
      const txid = tx.getId();
      await tx_broadcast(conf, tx);
      setFee(exactFee);
      const explorerLink = conf.explorer_tx?`\n${conf.explorer_tx}${txid}`:'';
      alert(`Transaction sent!\nTXID: ${txid}${explorerLink}`);
      setToAddress('');
      setAmountSat('');
      onSent?.();
    } catch(err){
      alert(err.message);
    } finally {
      setSending(false);
    }
  };
  const symbol = conf.symbol;
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
        type="text"
        placeholder={`Amount (${symbol})`}
        value={amountSat}
        onChange={e=>setAmountSat(e.target.value)}
        style={{display: 'block', width: '100%', marginTop: 8, boxSizing: 'border-box'}}
      />
      <FeeField value={fee} onChange={setFee} conf={conf} />
      <button onClick={handleSend} disabled={sending} style={{marginTop: 8}}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

// Inscribe Screen
function InscribeScreen({wallet, onSent}){
  const {conf, utxos=[], changeAddrInfo} = wallet;
  const [inscKey, setInscKey] = useState('');
  const [inscVal, setInscVal] = useState('');
  const [sending, setSending] = useState(false);
  const [nameStatus, setNameStatus] = useState(null); // null | 'checking' | 'available' | 'taken'
  const [valError, setValError] = useState(false);
  const [feeRate, setFeeRate] = useState(wallet.feeRate||conf.fee_def);
  const [fee, setFee] = useState(()=>{
    try {
      const fr = wallet.feeRate||conf.fee_def;
      return kv_tx_add(wallet, '', '', fr, fr, true).exactFee;
    } catch(e){ return wallet.feeRate||conf.fee_def; }
  });
  useEffect(()=>{
    try {
      const {exactFee} = kv_tx_add(wallet, inscKey.trim(), inscVal.trim(), fee, feeRate, true);
      setFee(exactFee);
    } catch(e){}
  }, [inscKey, inscVal, feeRate]);

  useEffect(()=>{
    const key = inscKey.trim();
    if (!key){
      setNameStatus(null);
      return;
    }
    setNameStatus('checking');
    const timer = setTimeout(()=>{
      (async()=>{
        try {
          let kv = await kv_get(conf, key);
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
  }, [inscKey]);
  const handleInscribe = async()=>{
    if (!inscKey.trim())
      return alert('Key is required');
    if (!inscVal.trim())
      return alert('Value is required');
    setSending(true);
    try {
      const {exactFee, tx} = kv_tx_add(wallet,
        inscKey.trim(), inscVal.trim(), fee, feeRate);
      const txid = tx.getId();
      await tx_broadcast(conf, tx);
      setFee(exactFee);
      alert(`Inscription sent!\nTXID: ${txid}`);
      setInscKey('');
      setInscVal('');
      onSent?.();
    } catch(err){
      alert(err.message);
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
      <FeeField value={fee} onChange={setFee} conf={conf} />
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
