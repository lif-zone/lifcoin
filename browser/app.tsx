// from code.esm.sh
import React from 'react';

// node env
globalThis.global = globalThis; // for bsock npm
import buffer from 'buffer';
globalThis.Buffer = buffer.Buffer;
process.env.NODE_BACKEND = 'js'; // for bcrypto npm
import fs from "fs";
console.log(fs);

// main app
let app = (await import('./src/app.js')).default;

const App = ()=>{
  return (<>
    <h1>Lifcoin, the browser full node</h1>
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
