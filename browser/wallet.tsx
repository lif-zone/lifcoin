// App.js
import React, {useState, useEffect} from 'react';
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

// Network configurations
const NETWORKS = {
  mainnet: {
    name: 'Bitcoin Mainnet',
    network: bitcoin.networks.bitcoin,
    //electrum: 'wss://electrumx.nimiq.com:443/electrumx', // restricted from localhost:5000
    electrum: 'wss://bitcoinserver.nl:50004', // unrestricted
  },
  testnet: {
    name: 'Bitcoin Testnet',
    network: bitcoin.networks.testnet,
    electrum: 'wss://electrum.blockstream.info:993',
  },
  lif: {
    name: 'Lif Mainnet',
    network: bitcoin.networks.lif,
    electrum: 'ws://localhost:8432',
  },
};

function ElectrumClient_connect(url){
  let u = URL.parse(url);
  let protocol = u.protocol.slice(0, -1); // 'wss:' -> 'wss'
  let port = u.port || (protocol=='wss' ? '443' : protocol=='ws' ? '80' : '');
  let host = u.hostname;
  let path = u.pathname;
  return new ElectrumClient(host, port+path, protocol);
}

function App(){
  const [_network, setNetwork] = useState('mainnet');
  const [mnemonic, setMnemonic] = useState('');
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [client, setClient] = useState(null);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState(0);
  const [privateKey, setPrivateKey] = useState(null); // ECPair
  const [showRestoreInput, setShowRestoreInput] = useState(false);
  const [restoreMnemonicInput, setRestoreMnemonicInput] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [_backup, setBackup] = useState(false);

  const conf = NETWORKS[_network];
  const network = conf.network;

  useEffect(()=>{
    const connectElectrum = async()=>{
      const cl = ElectrumClient_connect(conf.electrum);
      try {
        await cl.connect('lif-coin-wallet', '1.4');
        setClient(cl);
        console.log('Connected to Electrum');
      } catch (err) {
        console.error('Failed to connect:', err);
      }
    };
    connectElectrum();
    return ()=>{
      if (client)
        client.close();
    };
  }, [_network]);

  const restoreWallet = ()=>{
    const cleaned = restoreMnemonicInput.trim().toLowerCase();
    if (!bip39.validateMnemonic(cleaned))
      return void setRestoreError('Invalid mnemonic phrase (12/24 words)');
    deriveWalletFromMnemonic(cleaned);
    setShowRestoreInput(false);
    setRestoreMnemonicInput('');
  };

  const deriveWalletFromMnemonic = mn=>{
    let seed;
    try {
      seed = bip39.mnemonicToSeedSync(mn);
    } catch(err){
      console.error(err);
      setRestoreError('Failed to derive wallet. Invalid seed?');
    }
    const root = bip32.fromSeed(seed, network);
    const child = root.derivePath("m/84'/0'/0'/0/0"); // BIP84 native SegWit
    const {address: addr} = bitcoin.payments.p2wpkh(
      {pubkey: Buffer(child.publicKey), network});
    const keyPair = ecpair.fromPrivateKey(child.privateKey, {network});
    setMnemonic(mn);
    setAddress(addr);
    setPrivateKey(keyPair);
    setRestoreError('');
    fetchBalanceAndHistory(addr);
  };

  const generateWallet = ()=>{
    const mn = bip39.generateMnemonic(); // defaults to 12 words (128 bits)
    deriveWalletFromMnemonic(mn);
  };

  const getScriptHash = addr=>{
    const script = bitcoin.address.toOutputScript(addr, network);
    const hash = bitcoin.crypto.sha256(script);
    const reversedHash = Buffer.from(hash.reverse());
    return reversedHash.toString('hex');
  };

  const fetchBalanceAndHistory = async(addr)=>{
    if (!client || !addr) return;
    const scripthash = getScriptHash(addr);
    try {
      const bal = await client.blockchain_scripthash_getBalance(scripthash);
      setBalance(bal.confirmed + bal.unconfirmed);
      const hist = await client.blockchain_scripthash_getHistory(scripthash);
      setTransactions(hist);
    } catch (err){
      console.error('Error fetching data:', err);
    }
  };

  const sendBitcoin = async()=>{
    if (!client || !privateKey || !address)
      return;
    // Simple send: assumes one UTXO, no change for simplicity. REAL WALLET NEEDS PROPER UTXO MANAGEMENT!
    // This is VERY simplistic and may not work if no UTXOs or fees wrong.
    const scripthash = getScriptHash(address);
    const utxos = await client.blockchain_scripthash_listunspent(scripthash);
    if (!utxos.length){
      alert('No UTXOs');
      return;
    }
    // Take first UTXO for simplicity
    const utxo = utxos[0];
    const fee = 1000; // Satoshi, arbitrary
    const psbt = new bitcoin.Psbt({network});
    psbt.addInput({
      hash: utxo.tx_hash,
      index: utxo.tx_pos,
      witnessUtxo: {script: bitcoin.address.toOutputScript(address, network),
        value: utxo.value},
    });
    psbt.addOutput({
      address: toAddress,
      value: amount,
    });
    const change = utxo.value - amount - fee;
    if (change>0){
      psbt.addOutput({
        address: address,
        value: change,
      });
    }
    psbt.signInput(0, privateKey);
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction().toHex();
    try {
      const txid = await client.blockchain_transaction_broadcast(tx);
      alert(`Transaction sent: ${txid}`);
      fetchBalanceAndHistory(address);
    } catch(err){
      console.error('Error broadcasting:', err);
      alert('Failed to send');
    }
  };

  return (
    <div>
      <h1>Simple Bitcoin Wallet</h1>
      <button onClick={generateWallet}>Create New Wallet</button>
      <button onClick={()=>setShowRestoreInput(!showRestoreInput)}>
        {showRestoreInput ? 'Cancel' : 'Restore Wallet'}
      </button>
      <div>
        <label>Network: </label>
        <select
          value={_network}
          onChange={e=>setNetwork(e.target.value)}
        >
          <option value="mainnet">Bitcoin Mainnet</option>
          <option value="testnet">Bitcoin Testnet</option>
          <option value="lif">Lif Mainnet</option>
        </select>
        <p>
          Using: {conf.name} {conf.electrum}
        </p>
      </div>
      {showRestoreInput && (
        <div>
          <h3>Restore from mnemonic</h3>
          <textarea
            rows={4}
            style={{width: '100%'}}
            placeholder="Enter wallet's 12/24 words"
            value={restoreMnemonicInput}
            onChange={e=>setRestoreMnemonicInput(e.target.value)}
          />
          <button onClick={restoreWallet}>Restore</button>
          {restoreError && <p style={{color: 'red'}}>{restoreError}</p>}
        </div>
      )}
      <button onClick={()=>setBackup(!_backup)}>{!_backup ? 'Backup/Show Wallet' : 'Hide Wallet'}</button>
      {mnemonic && _backup && <p>Mnemonic: {mnemonic}</p>}
      {!mnemonic && <p>No wallet set</p>}
      {address && <p>Address: {address}</p>}
      <p>Balance: {balance/1e8} BTC</p>
      <h2>Transactions</h2>
      <ul>
        {transactions.map((tx, i)=>(
          <li key={i}>Tx: {tx.tx_hash} Height: {tx.height}</li>
        ))}
      </ul>
      <h2>Send</h2>
      <input
        type="text"
        placeholder="To Address"
        value={toAddress}
        onChange={e=>setToAddress(e.target.value)}
      />
      <input
        type="number"
        placeholder="Amount (satoshi)"
        value={amount}
        onChange={e=>setAmount(parseInt(e.target.value))}
      />
      <button onClick={sendBitcoin}>Send</button>
    </div>
  );
}

export default App;
