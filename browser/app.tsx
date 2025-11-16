// from code.esm.sh
import React from 'react';

// node env
globalThis.global = globalThis; // for bsock npm
import buffer from 'buffer';
globalThis.Buffer = buffer.Buffer;
process.env.NODE_BACKEND = 'js'; // for bcrypto npm
import fs from "fs";

let nextId = 1;
let callbacks = {};
globalThis.setImmediate = function(fn /*, ...args */){
  if (typeof fn!='function')
    throw new TypeError('setImmediate argument must be a function');
  var id = nextId++;
  var args = Array.prototype.slice.call(arguments, 1);
  callbacks[id] = true; // mark as active
  setTimeout(function(){
    if (!callbacks[id])
      return
    delete callbacks[id];
    fn.apply(null, args);
  }, 0);
  return id;
};

globalThis.clearImmediate = function(id){
  if (id)
    delete callbacks[id];
};

// main app
let app;
async function start_app(){
  if (app)
    return console.error('already started');
  console.log('loading lif-chain app');
  app = (await import('./src/app.js')).default;
  console.log('starting lif-chain app');
  await app();
  console.log('completed lif-chain app');
}

const App = ()=>{
  return (<>
    <h1>Lifcoin, the browser full node</h1>
    <p>
      <button onClick={()=>start_app()}>Start lif-coin node</button>
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
