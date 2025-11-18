import React from 'react';
import './node_env.js';
// lif-coin env
process.env.BCOIN_WORKER_FILE = import.meta.resolve('../lib/workers/worker.js');
process.argv = ['lif-coin'];
import fs from "./fs.js";

// main app
let app;
async function start_btc_node(){
  if (app)
    return console.error('already started');
  console.log('loading btc-chain app');
  app = (await import('./btc_node.js')).default;
  console.log('starting btc-chain app');
  await app();
  console.log('completed btc-chain app');
}

async function start_lif_node(){
  if (app)
    return console.error('already started');
  console.log('loading lif-chain app');
  app = (await import('./lif_node.js')).default;
  console.log('starting lif-chain app');
  await app();
  console.log('completed lif-chain app');
}

const App = ()=>{
  return (<>
    <h1>Lifcoin, the browser full node</h1>
    <p>
      <button onClick={()=>start_btc_node()}>Start bit-coin node</button>
      <button onClick={()=>start_lif_node()}>Start lif-coin node</button>
    </p>
    <small>
      Welcome. Your machine is currently validating the blockchain. The blocks
      and wallet are stored on your local disk with indexed DB. You are
      connecting to the actual bitcoin P2P network via a websocket-&gt;tcp
      proxy. Enjoy. (See the
      <a href="https://github.com/bcoin-org/bcoin"
        target="_blank">bcoin repo</a>
      for more bitcoin magic).
    </small>
    <div className="tx">
      <div>Chain State: <span id="state"></span></div>
      <div>Last 20 Blocks/TXs:</div>
      <div id="tx"></div>
    </div>
    <div id="log" className="log"></div>
    <form id="rpc" className="rpc" action="#">
      <input type="text" name="cmd" id="cmd"
        placeholder="RPC command (e.g. getblockchaininfo)" />
    </form>
    <div id="wallet" className="wallet"></div>
    <form id="send" className="send" action="#">
      <input type="text" name="address" id="address" placeholder="Address" />
      <input type="text" name="amount" id="amount" placeholder="Amount (BTC)" />
      <input type="submit" value="Send" />
    </form>
    <input type="button" id="newaddr" value="New Address" />
    <div id="floating" className="floating"></div>
  </>);
};

export default App;
