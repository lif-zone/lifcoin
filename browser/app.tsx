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
  console.log('loading lif-chain app');
  let exp = await import('./lif_node.js');
  debugger;
  //let {do_start, do_mine} = await import('./lif_node.js');
  let {do_start, do_mine} = exp;
  await do_start();
  await do_mine();
}

async function start_lif_gen_run_test(){
  console.log('loading gen.do_test');
  let {do_test} = await import('./gen.js');
  await do_test();
}

async function start_lif_gen_run_tx(){
  console.log('loading gen.tx');
  let {do_tx} = await import('./gen.js');
  await do_tx();
}

const App = ()=>{
  return (<>
    <h1>Lifcoin, the browser full node</h1>
    <p>
      <button onClick={()=>start_btc_node()}>Start bit-coin node</button>
      <button onClick={()=>start_lif_node()}>Start lif-coin node</button>
      <button onClick={()=>start_lif_gen_run_test()}>Start lif-gen</button>
      <button onClick={()=>start_lif_gen_tx()}>Start lif-tx</button>
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
