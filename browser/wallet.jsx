// wallet.jsx - bright wallet - BTC, LIF, multi-wallet support
import React, {useState, useEffect, useMemo} from 'react';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import {nets_list, servers_save, servers_load, wallet_db_init,
  nets_get, wallet_fetch, OV, OA, OE, esleep,
  wallet_add, wallet_del, wallet_update, wallets_get, wallet_get,
  hd_root, hd_wallet, hd_addr, hd_path_def,
  kv_get, tx_send, kv_tx_send, kv_tx_edit, kv_tx_add, tx_broadcast,
  cache_clear,
} from './wallet_db.js';

await wallet_db_init();

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
  const [servers, setServers] = useState(()=>servers_load());
  const networks = useMemo(()=>nets_get(servers), [servers]);
  const [wallets, setWallets] = useState(()=>wallets_get());
  const [screen, setScreen] = useState('home');
  const [activeWalletId, setActiveWalletId] = useState(null);
  const [selectedTxData, setSelectedTxData] = useState(null);
  const [selectedKeyData, setSelectedKeyData] = useState(null);
  const [cacheVer, setCacheVer] = useState(0);
  const [devTools, setDevTools] = useState(
    ()=>localStorage.getItem('dev_tools_enabled')=='1');
  useEffect(()=>{
    setWallets(wallets_get());
  }, [networks]);
  const addWallet = (w_ls)=>{
    wallet_add(w_ls);
    setWallets(wallets_get());
  };
  const updateWallet = (id, changes)=>{
    OA(wallet_get(id).ls, changes);
    wallet_update(id);
    setWallets(wallets_get());
  };
  const deleteWallet = (id)=>{
    wallet_del(id);
    setWallets(wallets_get());
    setScreen('home');
    setActiveWalletId(null);
  };
  const activeWallet = wallet_get(activeWalletId);
  const goHome = ()=>setScreen('home');
  const goBack = ()=>{
    if (screen=='kv_transfer' || screen=='kv_edit')
      setScreen('kv_info');
    else if (screen=='tx_info' || screen=='kv_info')
      setScreen('wallet_info');
    else if (screen=='wallet_send' || screen=='wallet_receive' ||
      screen=='wallet_kv_add' || screen=='wallet_settings')
      setScreen('wallet_info');
    else if (screen=='dev_tools')
      setScreen('settings');
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
        <Home_screen
          key={cacheVer}
          wallets={wallets}
          onSelect={(id)=>{ setActiveWalletId(id); setScreen('wallet_info'); }}
          onAddNew={()=>setScreen('wallet_add')}
        />
      )}
      {screen=='wallet_add' && (
        <Wallet_add_screen
          networks={networks}
          wallets={wallets}
          devTools={devTools}
          onAdd={(w_ls)=>{ addWallet(w_ls); goHome(); }}
          onCancel={goHome}
        />
      )}
      {screen=='wallet_info' && activeWallet && (
        <Wallet_screen
          wallet={activeWallet}
          onDelete={()=>deleteWallet(activeWallet.ls.id)}
          onUpdate={(changes)=>updateWallet(activeWallet.ls.id, changes)}
          onSelectTx={(data)=>{ setSelectedTxData(data); setScreen('tx_info'); }}
          onSelectKey={(data)=>{ setSelectedKeyData(data); setScreen('kv_info'); }}
          onSend={()=>setScreen('wallet_send')}
          onReceive={()=>setScreen('wallet_receive')}
          onKvAdd={()=>setScreen('wallet_kv_add')}
          onSettings={()=>setScreen('wallet_settings')}
        />
      )}
      {screen=='wallet_send' && activeWallet && (
        <SendScreen
          wallet={activeWallet}
          onSent={()=>setScreen('wallet_info')}
        />
      )}
      {screen=='wallet_receive' && activeWallet && (
        <Receive_screen
          address={activeWallet.c.receiveAddress}
          symbol={activeWallet.conf.symbol}
        />
      )}
      {screen=='wallet_kv_add' && activeWallet && (
        <Kv_add_screen
          wallet={activeWallet}
          onSent={()=>setScreen('wallet_info')}
        />
      )}
      {screen=='wallet_settings' && activeWallet && (
        <Wallet_settings_subscreen
          wallet={activeWallet}
          onUpdate={(changes)=>updateWallet(activeWallet.ls.id, changes)}
          onDelete={()=>deleteWallet(activeWallet.ls.id)}
        />
      )}
      {screen=='tx_info' && selectedTxData && activeWallet && (
        <Tx_info_screen
          tx={selectedTxData.tx}
          conf={selectedTxData.conf}
          walletAddrs={selectedTxData.walletAddrs}
          walletName={activeWallet.ls.name || (activeWallet.mode=='hd' ? 'HD Wallet' : 'Wallet')}
        />
      )}
      {screen=='kv_info' && selectedKeyData && activeWallet && (
        <Kv_info_screen
          kv_d={selectedKeyData}
          conf={activeWallet.conf}
          onViewTx={(tx)=>{ setSelectedTxData({tx, conf: activeWallet.conf, walletAddrs: selectedKeyData._walletAddrs}); setScreen('tx_info'); }}
          onTransfer={()=>setScreen('kv_transfer')}
          onEdit={(newVal)=>{ setSelectedKeyData(d=>({...d, _val_orig: d.val, val: newVal})); setScreen('kv_edit'); }}
        />
      )}
      {screen=='kv_transfer' && selectedKeyData && activeWallet && (
        <Kv_transfer_screen
          wallet={activeWallet}
          kv_d={selectedKeyData}
          onSent={()=>setScreen('wallet_info')}
        />
      )}
      {screen=='kv_edit' && selectedKeyData && activeWallet && (
        <Kv_edit_screen
          wallet={activeWallet}
          kv_d={selectedKeyData}
          onSent={()=>setScreen('wallet_info')}
        />
      )}
      {screen=='settings' && (
        <Settings_screen
          servers={servers}
          networks={networks}
          devTools={devTools}
          onSave={(s)=>{ setServers(s); servers_save(s); }}
          onDevToolsToggle={(v)=>{ setDevTools(v); localStorage.setItem('dev_tools_enabled', v ? '1' : '0'); }}
          onDevTools={()=>setScreen('dev_tools')}
          onBack={goHome}
        />
      )}
      {screen=='dev_tools' && (
        <Devtools_screen
          onCacheClear={async()=>{ await cache_clear(); setCacheVer(v=>v+1); }}
          onBack={()=>setScreen('settings')}
        />
      )}
    </div>
  );
}

// Home Screen
function Home_screen({wallets, onSelect, onAddNew}){
  return (
    <div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16}}>
        {OV(wallets).map(wallet=>(
          <Wallet_card
            key={wallet.ls.id}
            wallet={wallet}
            onClick={()=>onSelect(wallet.ls.id)}
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
function Wallet_card({wallet, onClick}){
  const conf = wallet.conf;
  const [balance, setBalance] = useState(wallet.c.balance ?? null);
  const [txCount, setTxCount] = useState(wallet.c.transactions?.length ?? null);
  const [keysOwned, setKeysOwned] = useState(wallet.c.ownedKeys?.length ?? 0);
  const [connErr, setConnErr] = useState(false);
  const derived = bip39.validateMnemonic(wallet.ls.mnemonic);

  const fetch_update = ()=>{
    if (wallet.c.balance==undefined)
      return;
    setBalance(wallet.c.balance);
    setTxCount(wallet.c.transactions.length);
    setKeysOwned(wallet.c.ownedKeys.length);
  };
  useEffect(()=>{
    if (!derived)
      return;
    (async()=>{
      try {
        await wallet_fetch(wallet);
        fetch_update();
      } catch(e){
        console.error('Wallet_card fetch error:', e);
        setConnErr(true);
      }
    })();
  }, [wallet.ls.id, wallet.ls.network, conf.electrum]);

  if (!derived){
    return (
      <div style={{...cardStyle, color: 'red'}} onClick={onClick}>
        <p>Invalid wallet</p>
      </div>
    );
  }

  const symbol = conf.symbol;
  const label = wallet.ls.name || '';
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
              <Amount sat={balance} symbol={symbol} signed />
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
function Wallet_add_screen({networks, wallets, devTools, onAdd, onCancel}){
  const [networkKey, setNetworkKey] = useState('lif');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [derivPath, setDerivPath] = useState(
    ()=>hd_path_def(networks['lif']));
  const [mnemonicInput, setMnemonicInput] = useState(bip39.generateMnemonic());
  const defaultName = (()=>{
    let max = 0;
    for (const w of OV(wallets)){
      const m = w.ls.name && w.ls.name.match(/^Wallet #(\d+)$/);
      if (m)
        max = Math.max(max, parseInt(m[1], 10));
    }
    return 'Wallet #'+(max+1);
  })();
  const [name, setName] = useState(defaultName);
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const handleAdd = ()=>{
    setError('');
    const cleaned = mnemonicInput.trim().toLowerCase();
    if (!bip39.validateMnemonic(cleaned))
      return void setError('Invalid mnemonic phrase');
    const mnemonic = cleaned;
    const pp = usePassphrase ? passphrase : '';
    const dp = showAdvanced ? derivPath.trim() : null;
    try {
      hd_wallet(mnemonic, networkKey, networks, pp, dp);
    } catch(e){
      return void setError('Failed to derive wallet: '+e.message);
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
        <label>Coin:</label>
        <div style={{marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4}}>
          {OE(networks).filter(([key])=>devTools||!nets_list[key]?.test).map(([key, conf])=>(
            <label key={key} style={{display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}>
              <input
                type="radio"
                name="network"
                value={key}
                checked={networkKey==key}
                onChange={()=>{ setNetworkKey(key); setDerivPath(hd_path_def(networks[key])); }}
              />
              {conf.symbol} ({conf.name})
            </label>
          ))}
        </div>
      </div>
      <div style={{marginTop: 12}}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <label>Wallet secret 12 words - WRITE THIS DOWN ON PAPER:</label>
        </div>
        <textarea
          rows={4}
          placeholder={'Enter the 12 or 24 secret words of your wallet'}
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
          Passphrase
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
function Wallet_screen({wallet, onDelete, onUpdate, onSelectTx, onSelectKey,
  onSend, onReceive, onKvAdd, onSettings})
{
  const conf = wallet.conf;
  const [balance, setBalance] = useState(wallet.c.balance ?? null);
  const [transactions, setTransactions] = useState(wallet.c.transactions ?? []);
  const [ownedKeys, setOwnedKeys] = useState(wallet.c.ownedKeys ?? []);
  const [loading, setLoading] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const [allAddrs, setAllAddrs] = useState(wallet.c.addrs ?? []);
  const wallet_apply = (wallet)=>{
    setBalance(wallet.c.balance);
    setTransactions(wallet.c.transactions);
    setOwnedKeys(wallet.c.ownedKeys);
    setAllAddrs(wallet.c.addrs);
  };

  useEffect(()=>{
    if (!bip39.validateMnemonic(wallet.ls.mnemonic))
      return;
    (async()=>{
      try {
        setLoading(true);
        wallet_apply(await wallet_fetch(wallet, true));
      } catch(e){
        console.error('Connect error:', e);
        setConnErr(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [wallet.ls.id, wallet.ls.network]);

  const symbol = conf.symbol;
  const label = wallet.ls.name || '';
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
          : <Amount sat={balance} symbol={symbol} signed />
        }
      </div>
      <div style={{display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center'}}>
        <button onClick={onReceive} disabled={!allAddrs.length}>Receive</button>
        <button onClick={onSend} disabled={!allAddrs.length}>Send</button>
        {conf.lif_kv && <button onClick={onKvAdd} disabled={!allAddrs.length}>Get Domain</button>}
        <button onClick={onSettings} style={{marginLeft: 'auto'}}>⚙ Settings</button>
      </div>
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
            {transactions.map((tx, i)=>(
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
                <Amount sat={tx.amount} symbol={symbol} signed />
              </li>
            ))}
          </ul>
        )}
        <button style={{marginTop: 10}} onClick={async()=>{
          setLoading(true);
          try { wallet_apply(await wallet_fetch(wallet, true)); }
          catch(e){ console.error('Refresh error:', e); }
          finally { setLoading(false); }
        }}>
          Refresh
        </button>
      </div>
    </div>
  );
}

// Wallet Settings Subscreen
function Wallet_settings_subscreen({wallet, onUpdate, onDelete}){
  const conf = wallet.conf;
  const [revealed, setRevealed] = useState(false);
  const [name, setName] = useState(wallet.ls.name);
  const hasPassphrase = !!wallet.ls.passphrase;
  const derivPath = wallet.ls.derivPath || hd_path_def(conf);
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
          value={wallet.ls.mnemonic}
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
            value={wallet.ls.passphrase}
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
function Receive_screen({address, symbol}){
  const [copied, setCopied] = useState(false);
  const handleCopy = async()=>{
    navigator.clipboard.writeText(address);
    setCopied(true);
    await esleep(2000);
    setCopied(false);
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
function Kv_info_screen({kv_d, conf, onViewTx, onTransfer, onEdit}){
  const tx = kv_d._tx;
  const date = tx?.timestamp ? new Date(tx.timestamp*1000).toLocaleString()
    : null;
  const statusColor = kv_d._kstatus=='confirmed' ? 'green' :
    kv_d._kstatus=='receiving' ? '#f90' : '#c00';
  const statusLabel = kv_d._kstatus=='confirmed' ? 'Confirmed' :
    kv_d._kstatus=='receiving' ? 'Unconfirmed' : 'Spent';
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const startEdit = ()=>{ setEditVal(json(kv_d.val)); setEditing(true); };
  const isSpent = kv_d._kstatus=='spent';
  return (
    <div style={{marginTop: 16, maxWidth: 600}}>
      <h3>Name <span style={{color: statusColor, fontFamily: 'monospace'}}>{kv_d.key}</span></h3>
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
          <div style={{fontFamily: 'monospace', wordBreak: 'break-all', whiteSpace: 'pre-wrap', marginTop: 2}}>{json(kv_d.val)}</div>
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
function Kv_transfer_screen({wallet, kv_d, onSent}){
  const conf = wallet.conf;
  const [toAddress, setToAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [fee, setFee] = useState(()=>{
    try {
      const addr = wallet.c.changeAddrInfo?.address||'';
      return kv_tx_send(wallet, kv_d, addr).fee;
    } catch(e){ return 0; }
  });

  const handleTransfer = async()=>{
    if (!toAddress.trim())
      return alert('Enter recipient address');
    setSending(true);
    try {
      const {fee: _fee, tx} = kv_tx_send(wallet, kv_d, toAddress.trim(), fee);
      const txid = tx.getId();
      await tx_broadcast(conf, tx);
      setFee(_fee);
      const explorerLink = conf.explorer_tx ? `\n${conf.explorer_tx}${txid}` : '';
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
        Transferring: <span style={{fontFamily: 'monospace'}}>{kv_d.key}</span>
      </div>
      <input
        placeholder="Recipient address"
        value={toAddress}
        onChange={e=>setToAddress(e.target.value)}
        style={{display: 'block', width: '100%', marginTop: 12, boxSizing: 'border-box'}}
      />
      <Fee_field value={fee} onChange={setFee} conf={conf} />
      <button onClick={handleTransfer} disabled={sending} style={{marginTop: 8}}>
        {sending ? 'Transferring…' : 'Transfer'}
      </button>
    </div>
  );
}

// Name Edit Screen
function Kv_edit_screen({wallet, kv_d, onSent}){
  const conf = wallet.conf;
  const [sending, setSending] = useState(false);
  const [fee, setFee] = useState(()=>{
    try { return kv_tx_edit(wallet, kv_d).fee; }
    catch(e){ return 0; }
  });

  const handleSave = async()=>{
    setSending(true);
    try {
      const {fee: _fee, tx} = kv_tx_edit(wallet, kv_d, fee);
      const txid = tx.getId();
      await tx_broadcast(conf, tx);
      setFee(_fee);
      const explorerLink = conf.explorer_tx ? `\n${conf.explorer_tx}${txid}` : '';
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
      <h3>Edit Domain Name</h3>
      <div style={{marginTop: 8, color: '#666', fontSize: 13}}>
        Name: <span style={{fontFamily: 'monospace'}}>{kv_d.key}</span>
      </div>
      <div style={{marginTop: 8, color: '#666', fontSize: 13}}>
        New value: <span style={{fontFamily: 'monospace'}}>{kv_d.val}</span>
      </div>
      <Fee_field value={fee} onChange={setFee} conf={conf} />
      <button onClick={handleSave} disabled={sending} style={{marginTop: 12}}>
        {sending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// Tx Detail Screen
function Tx_info_screen({tx, conf, walletAddrs, walletName}){
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
          <Amount sat={tx.amount} symbol={symbol} signed />
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
          const value = vin._prevVout ? Math.round(vin._prevVout.value*1e8)
            : null;
          const ours = walletAddrs.has(addr);
          return (
            <div key={i} style={{fontFamily: 'monospace', fontSize: 12, marginTop: 3,
              color: ours ? '#c00' : 'inherit'}}
            >
              {addr}{value!==null && <> <Amount sat={-value} symbol={symbol} signed /></>}{ours && ' ← yours'}
            </div>
          );
        })}
        <h4 style={{marginTop: 12}}>Outputs</h4>
        {(tx._vtx.vout||[]).map((vout, i)=>{
          const addr = voutAddr(vout);
          const value = Math.round(vout.value*1e8);
          const ours = walletAddrs.has(addr);
          return (
            <div key={i} style={{fontFamily: 'monospace', fontSize: 12, marginTop: 3,
              color: ours ? 'green' : 'inherit'}}
            >
              {addr}: <Amount sat={value} symbol={symbol} signed />{ours && ' ← yours'}
            </div>
          );
        })}
      </>)}
    </div>
  );
}

function Amount({sat, symbol, signed}){
  const sign = !signed ? null : sat>0 ? '+' : sat<0 ? '-' : '';
  const color = !signed ? null : sat>0 ? 'green' : sat<0 ? '#c00' : null;
  const [int, dec] = (Math.abs(sat)/1e8).toFixed(8).split('.');
  const sig = dec.replace(/0+$/, '');
  const zeros = dec.slice(sig.length);
  return (
    <span style={{fontFamily: 'monospace', ...(color&&{color})}}>
      {sign}{int}
      {sig.length===0
        ? <span style={{color: '#aaa'}}>.{zeros}</span>
        : <>.{sig}{zeros && <span style={{color: '#aaa'}}>{zeros}</span>}</>
      }{symbol ? ' '+symbol : ''}
    </span>
  );
}

function Fee_field({value, onChange, conf}){
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
        ><Amount sat={value} symbol={symbol} /></span>
      )}
    </div>
  );
}

// Send Screen
function SendScreen({wallet, onSent}){
  const {conf, c: {utxos=[], changeAddrInfo}} = wallet;
  const [toAddress, setToAddress] = useState('');
  const [amountSat, setAmountSat] = useState('');
  const [sending, setSending] = useState(false);
  const [fee, setFee] = useState(()=>{
    try { return tx_send(wallet, changeAddrInfo.address, 1).fee; }
    catch(e){ return 0; }
  });
  useEffect(()=>{
    const amount = Math.round(parseFloat(amountSat)*1e8);
    const target = amount>0 ? amount : 1;
    try { setFee(tx_send(wallet, changeAddrInfo.address, target).fee); }
    catch(e){}
  }, [amountSat, utxos]);
  const handleSend = async()=>{
    const amountValue = Math.round(parseFloat(amountSat)*1e8);
    if (isNaN(amountValue)||amountValue<=0)
      return alert('Invalid amount');
    setSending(true);
    try {
      const {fee: _fee, tx} = tx_send(wallet, toAddress, amountValue, fee);
      const txid = tx.getId();
      await tx_broadcast(conf, tx);
      setFee(_fee);
      const explorerLink = conf.explorer_tx ? `\n${conf.explorer_tx}${txid}` : '';
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
      <Fee_field value={fee} onChange={setFee} conf={conf} />
      <button onClick={handleSend} disabled={sending} style={{marginTop: 8}}>
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

// KV add Screen
function Kv_add_screen({wallet, onSent}){
  const {conf, c: {utxos=[], changeAddrInfo}} = wallet;
  const [kv_key, set_kv_key] = useState('');
  const [kv_val, set_kv_val] = useState('');
  const [sending, setSending] = useState(false);
  const [nameStatus, setNameStatus] = useState(null); // null | 'checking' | 'available' | 'taken'
  const [valError, setValError] = useState(false);
  const [fee, setFee] = useState(()=>{
    try { return kv_tx_add(wallet, kv_key.trim(), kv_val.trim()).fee; }
    catch(e){ return 0; }
  });
  useEffect(()=>{
    try {
      const {fee} = kv_tx_add(wallet, kv_key.trim(), kv_val.trim());
      setFee(fee);
    } catch(e){}
  }, [kv_key, kv_val]);

  useEffect(()=>{
    (async()=>{
      const key = kv_key.trim();
      if (!key){
        setNameStatus(null);
        return;
      }
      setNameStatus('checking');
      await esleep(500);
      try {
        let kv = await kv_get(conf, key);
        if (!kv) // this electrumx client returns undefined for error responses
          setNameStatus('available');
        else
          setNameStatus('taken');
      } catch(e){
        setNameStatus('error');
      }
    })();
  }, [kv_key]);
  const handle_kv_add = async()=>{
    if (!kv_key.trim())
      return alert('Key is required');
    if (!kv_val.trim())
      return alert('Value is required');
    setSending(true);
    try {
      const {fee: _fee, tx} = kv_tx_add(wallet, kv_key.trim(), kv_val.trim(), fee);
      const txid = tx.getId();
      await tx_broadcast(conf, tx);
      setFee(_fee);
      alert(`Domain registration sent!\nTXID: ${txid}`);
      set_kv_key('');
      set_kv_val('');
      onSent?.();
    } catch(err){
      alert(err.message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div style={{marginTop: 16, maxWidth: 480}}>
      <h3>Register new domain</h3>
      <p style={{fontSize: 13, color: '#666', marginTop: 4}}>
        Writes a LIF key/value domain registration to the blockchain.
      </p>
      <div style={{marginTop: 12}}>
        <label>Name:</label>
        <input
          placeholder="e.g. dns/jungo"
          value={kv_key}
          onChange={e=>set_kv_key(e.target.value)}
          style={{display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace',
            fontSize: 13, boxSizing: 'border-box'}}
        />
        {nameStatus=='checking' && <div style={{fontSize: 12, color: '#aaa', marginTop: 3}}>Checking…</div>}
        {nameStatus=='available' && <div style={{fontSize: 12, color: 'green', marginTop: 3}}>Available</div>}
        {nameStatus=='taken' && <div style={{fontSize: 12, color: '#c00', marginTop: 3}}>Already taken</div>}
      </div>
      <div style={{marginTop: 12}}>
        <label>Value:</label>
        <textarea
          rows={5}
          placeholder={'{"site": "lif:git/..."}'}
          value={kv_val}
          onChange={e=>{ set_kv_val(e.target.value); try { JSON.parse(e.target.value); setValError(false); } catch { setValError(true); } }}
          style={{display: 'block', width: '100%', marginTop: 4, fontFamily: 'monospace',
            fontSize: 13, boxSizing: 'border-box'}}
        />
        {valError && <div style={{fontSize: 12, color: '#c00', marginTop: 3}}>Invalid JSON</div>}
      </div>
      <Fee_field value={fee} onChange={setFee} conf={conf} />
      <button onClick={handle_kv_add} disabled={sending||nameStatus=='taken'||valError} style={{marginTop: 12}}>
        {sending ? 'Registering…' : 'Registered'}
      </button>
    </div>
  );
}

// Settings Screen
function Settings_screen({servers, networks, devTools, onSave, onDevToolsToggle,
  onDevTools, onBack})
{
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
    setValues(v=>({...v, [key]: nets_list[key]?.electrum || ''}));
  };
  return (
    <div style={{maxWidth: 520}}>
      <h2>Settings</h2>
      <h3 style={{marginTop: 16}}>ElectrumX Servers</h3>
      <p style={{fontSize: 13, color: '#666', marginTop: 4}}>
        Configure the ElectrumX server URL for each network.
      </p>
      {OE(networks).filter(([key])=>devTools||!nets_list[key]?.test).map(([key, conf])=>(
        <div key={key} style={{marginTop: 14}}>
          <label style={{fontWeight: 'bold'}}>{conf.name}:</label>
          <div style={{display: 'flex', gap: 6, marginTop: 4}}>
            <input
              value={values[key] || ''}
              onChange={e=>setValues(v=>({...v, [key]: e.target.value}))}
              placeholder={nets_list[key]?.electrum}
              style={{flex: 1, fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box'}}
            />
            <button onClick={()=>handleReset(key)} title="Reset to default">↺</button>
          </div>
        </div>
      ))}
      <button onClick={handleSave} style={{marginTop: 20}}>Save Settings</button>
      <div style={{marginTop: 28}}>
        <label style={{display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}>
          <input
            type="checkbox"
            checked={devTools}
            onChange={e=>onDevToolsToggle(e.target.checked)}
          />
          Enable Developer Tools
        </label>
        {devTools && (
          <button onClick={onDevTools} style={{marginTop: 10}}>Developer Tools</button>
        )}
      </div>
    </div>
  );
}

const LIF_SERVER_DEF = 'http://localhost:8432';
function lif_server_load(){
  return localStorage.getItem('lif_server') || LIF_SERVER_DEF;
}
function lif_server_save(val){
  localStorage.setItem('lif_server', val);
}

// Developer Tools Screen
function Devtools_screen({onCacheClear, onBack}){
  const [lifServer, setLifServer] = useState(lif_server_load);
  const [mempoolCmd, setMempoolCmd] = useState(null);
  const [mempoolResult, setMempoolResult] = useState(null);
  const handleServerChange = (val)=>{
    setLifServer(val);
    lif_server_save(val);
  };
  const handleResetMempool = async()=>{
    const url = `${lifServer}/reset_mempool`;
    setMempoolCmd(`curl -X POST ${url}`);
    setMempoolResult(null);
    try {
      const res = await fetch(url, {method: 'POST'});
      setMempoolResult(await res.json());
    } catch(e){
      setMempoolResult({error: e.message});
    }
  };
  return (
    <div style={{maxWidth: 520}}>
      <h2>Developer Tools</h2>
      <div style={{marginTop: 16}}>
        <button onClick={onCacheClear}>Clear Cache</button>
        <p style={{fontSize: 13, color: '#666', marginTop: 6}}>
          Clears all cached wallet data and re-fetches from Electrum.
        </p>
      </div>
      <div style={{marginTop: 20}}>
        <label style={{fontWeight: 'bold'}}>Lifcoin Server:</label>
        <div style={{display: 'flex', gap: 6, marginTop: 4}}>
          <input
            value={lifServer}
            onChange={e=>handleServerChange(e.target.value)}
            placeholder={LIF_SERVER_DEF}
            style={{flex: 1, fontFamily: 'monospace', fontSize: 12, boxSizing: 'border-box'}}
          />
          <button onClick={()=>handleServerChange(LIF_SERVER_DEF)} title="Reset to default">↺</button>
        </div>
      </div>
      <div style={{marginTop: 16}}>
        <button onClick={handleResetMempool}>Reset lifcoin mempool</button>
        {mempoolCmd && (
          <pre style={{marginTop: 8, fontSize: 12, background: '#f4f4f4',
            padding: 8, borderRadius: 4, overflowX: 'auto'}}>
            {mempoolCmd}{'\n'}
            {mempoolResult ? JSON.stringify(mempoolResult, null, 2) : 'Fetching...'}
          </pre>
        )}
      </div>
    </div>
  );
}

export default BrightWallet;
