// App.js
import React, {useState, useEffect} from 'react';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import * as bip32 from 'bip32';
import ElectrumClient from '@aguycalled/electrum-client-js';

const network = bitcoin.networks.bitcoin;
const ELECTRUM_HOST = 'localhost';
const ELECTRUM_PORT = 8432;
const ELECTRUM_PROTOCOL = 'ws';

function App(){
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

  useEffect(()=>{
    const connectElectrum = async()=>{
      const cl = new ElectrumClient(ELECTRUM_HOST, ELECTRUM_PORT, ELECTRUM_PROTOCOL);
      try {
        await cl.connect('lif-coin-wallet', '26.1.29');
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
  }, []);

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
    } catch (err) {
      console.error(err);
      setRestoreError('Failed to derive wallet. Invalid seed?');
    }
    const root = bip32.fromSeed(seed, network);
    const child = root.derivePath("m/84'/0'/0'/0/0"); // BIP84 native SegWit
    const { address: addr } = bitcoin.payments.p2wpkh(
      {pubkey: child.publicKey, network});
    const keyPair = bitcoin.ECPair.fromPrivateKey(child.privateKey, {network});
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
      {showRestoreInput && (
        <div>
          <h3>Restore from mnemonic</h3>
          <textarea
            rows={4}
            style={{ width: '100%'}}
            placeholder="Enter wallet's 12/24 words"
            value={restoreMnemonicInput}
            onChange={e=>setRestoreMnemonicInput(e.target.value)}
          />
          <button onClick={restoreWallet}>Restore</button>
          {restoreError && <p style={{color: 'red'}}>{restoreError}</p>}
        </div>
      )}
      <button>Backup Wallet</button>
      {mnemonic && <p>Mnemonic: {mnemonic}</p>}
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
