// from code.esm.sh
import React from 'react';

const App = ()=>{
  return (<>
    <h1>Bcoin, the browser full node</h1>
    <small>
      Welcome. Your machine is currently validating the blockchain. The blocks
      and wallet are stored on your local disk with indexed DB. You are
      connecting to the actual bitcoin P2P network via a websocket-&gt;tcp
      proxy. Enjoy. (See the
      <a href="https://github.com/bcoin-org/bcoin"
        target="_blank">bcoin repo</a>
      for more bitcoin magic).
    </small>
    <div class="tx">
      <div>Chain State: <span id="state"></span></div>
      <div>Last 20 Blocks/TXs:</div>
      <div id="tx"></div>
    </div>
    <div id="log" class="log"></div>
    <form id="rpc" class="rpc" action="#">
      <input type="text" name="cmd" id="cmd"
        placeholder="RPC command (e.g. getblockchaininfo)" />
    </form>
    <div id="wallet" class="wallet"></div>
    <form id="send" class="send" action="#">
      <input type="text" name="address" id="address" placeholder="Address" />
      <input type="text" name="amount" id="amount" placeholder="Amount (BTC)" />
      <input type="submit" value="Send" />
    </form>
    <input type="button" id="newaddr" value="New Address" />
    <div id="floating" class="floating"></div>
  </>);
};

export default App;
