/*!
 * server.js - http server for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const path = require('path');
const EventEmitter = require('events');
const {Server} = require('bweb');
const Validator = require('bval');
const base58 = require('bcrypto/lib/encoding/base58');
const {BloomFilter} = require('bfilter');
const sha256 = require('bcrypto/lib/sha256');
const random = require('bcrypto/lib/random');
const {safeEqual} = require('bcrypto/lib/safe');
const util = require('../utils/util');
const Address = require('../primitives/address');
const TX = require('../primitives/tx');
const Coin = require('../primitives/coin');
const Outpoint = require('../primitives/outpoint');
const Network = require('../protocol/network');
const Script = require('../script/script');
const pkg = require('../pkg');
const {WebSocketServer} = require('ws');

/**
 * HTTP
 * @alias module:http.Server
 */

class HTTP extends Server {
  /**
   * Create an http server.
   * @constructor
   * @param {Object} options
   */

  constructor(options) {
    super(new HTTPOptions({...options, sockets: false}));
    this.network = this.options.network;
    this.logger = this.options.logger.context('node-http');
    this.node = this.options.node;
    this.chain = this.node.chain;
    this.mempool = this.node.mempool;
    this.pool = this.node.pool;
    this.fees = this.node.fees;
    this.miner = this.node.miner;
    this.rpc = this.node.rpc;
    this.init();
  }

  /**
   * Initialize routes.
   * @private
   */

  init() {
    this.on('request', (req, res) => {
      if (req.method === 'POST' && req.pathname === '/')
        return;
      this.logger.debug('Request for method=%s path=%s (%s).',
        req.method, req.pathname, req.socket.remoteAddress);
    });
    this.on('listening', (address) => {
      this.logger.info('Node HTTP server listening on %s (port=%d).',
        address.address, address.port);
    });
    this.initRouter();
    // this.channel() this.to() this.join() this.leave() this.all()
    // are all calls to this.io.xxx()
    this.initSocketIO(); // socket-io over websocket - disabled
    this.init_electrum(); // electrumx over websocket
  }

  /**
   * Initialize routes.
   * @private
   */

  initRouter() {
    if (this.options.cors)
      this.use(this.cors());

    if (!this.options.noAuth) {
      this.use(this.basicAuth({
        hash: sha256.digest,
        password: this.options.apiKey,
        realm: 'node'
      }));
    }

    this.use(this.bodyParser({
      type: 'json'
    }));

    this.use(this.jsonRPC());
    this.use(this.router());

    this.error((err, req, res) => {
      const code = err.statusCode || 500;
      res.json(code, {
        error: {
          type: err.type,
          code: err.code,
          message: err.message
        }
      });
    });

    this.get('/', async (req, res) => {
      const totalTX = this.mempool ? this.mempool.map.size : 0;
      const size = this.mempool ? this.mempool.getSize() : 0;
      const orphans = this.mempool ? this.mempool.orphans.size : 0;

      let addr = this.pool.hosts.getLocal();

      const filter = {};
      for (const type of this.node.filterIndexers.keys()) {
        const indexer = this.node.filterIndexers.get(type);
        filter[type] = {
          enabled: true,
          height: indexer.height
        };
      }

      if (!addr)
        addr = this.pool.hosts.address;

      res.json(200, {
        version: pkg.version,
        network: this.network.type,
        chain: {
          height: this.chain.height,
          tip: this.chain.tip.rhash(),
          progress: this.chain.getProgress()
        },
        indexes: {
          addr: {
            enabled: Boolean(this.node.addrindex),
            height: this.node.addrindex ? this.node.addrindex.height : 0
          },
          tx: {
            enabled: Boolean(this.node.txindex),
            height: this.node.txindex ? this.node.txindex.height : 0
          },
          filter
        },
        pool: {
          host: addr.host,
          port: addr.port,
          agent: this.pool.options.agent,
          services: this.pool.options.services.toString(2),
          outbound: this.pool.peers.outbound,
          inbound: this.pool.peers.inbound
        },
        mempool: {
          tx: totalTX,
          size: size,
          orphans: orphans
        },
        time: {
          uptime: this.node.uptime(),
          system: util.now(),
          adjusted: this.network.now(),
          offset: this.network.time.offset
        },
        memory: this.logger.memoryUsage()
      });
    });

    // UTXO by addr
    this.get('/coin/address/:address', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const address = valid.str('address');
      const limit = valid.uint('limit', this.options.maxTxs);
      const reverse = valid.bool('reverse', false);
      const after = valid.brhash('after', null);
      const spent = valid.bool('spent', false);
      enforce(address, 'Address is required.');
      enforce(!this.chain.options.spv, 'Cannot get coins in SPV mode.');
      const addr = Address.fromString(address, this.network);
      const metas = await this.node.getMetaByAddrSH(
        addr, {limit, reverse, after});
      const coins = [];
      for (let m of metas){
        for (let i=0; i<m.tx.outputs.length; i++) {
          let a = m.tx.outputs[i].getAddress();
          if (!a||!a.equals(addr))
            continue;
          if (spent){ // include also spent coins
            coins.push(Coin.fromTX(m.tx, i, m.height));
            continue;
          }
          let coin;
          if (!(coin = await this.node.chain.getCoin(m.tx.hash(), i)))
            continue;
          coins.push(coin);
        }
      }
      let result = coins.map(c=>c.getJSON(this.network));
      res.json(200, result);
    });
    // UTXO by id
    this.get('/coin/:hash/:index', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const hash = valid.brhash('hash');
      const index = valid.u32('index');
      enforce(hash, 'Hash is required.');
      enforce(index != null, 'Index is required.');
      enforce(!this.chain.options.spv, 'Cannot get coins in SPV mode.');
      const coin = await this.node.getCoin(hash, index);
      if (!coin) {
        res.json(404);
        return;
      }
      res.json(200, coin.getJSON(this.network));
    });
    // TX by hash
    this.get('/tx/:hash', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const hash = valid.brhash('hash');
      enforce(hash, 'Hash is required.');
      enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');
      const meta = await this.node.getMeta(hash);
      enforce(meta, 'meta not found for tx');
      const view = await this.node.getMetaView(meta);
      res.json(200, meta.getJSON(this.network, view, this.chain.height));
    });
    // TX by address
    this.get('/tx/address/:address', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const address = valid.str('address');
      const limit = valid.uint('limit', this.options.maxTxs);
      const reverse = valid.bool('reverse', false);
      const after = valid.brhash('after', null);
      enforce(address, 'Address is required.');
      enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');
      enforce(limit <= this.options.maxTxs,
        `Limit above max of ${this.options.maxTxs}.`);
      const addr = Address.fromString(address, this.network);
      const metas = await this.node.getMetaByAddrSH(
        addr, {limit, reverse, after});
      const result = [];
      for (const meta of metas){
        const view = await this.node.getMetaView(meta);
        result.push(meta.getJSON(this.network, view, this.chain.height));
      }
      res.json(200, result);
    });
    // TX by address - blockchain.info api
    // https://blockchain.info/rawaddr/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh
    this.get('/blockchain.info/rawaddr/:address', async (req, res) => {
      let total_in = 0, total_out = 0, total_fee = 0;
      let valid = Validator.fromRequest(req);
      let address = valid.str('address');
      let limit = valid.uint('limit', this.options.maxTxs);
      let offset = valid.uint('offset', 0);
      enforce(address, 'Address is required.');
      enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');
      //enforce(this.chain.options.indexAddress, 'indexAddress not enabled.');
      // 1. missing offset implementation.
      // 2. make the resulting JSON match that of blockchain.info/rawaddr
      let addr = Address.fromString(address, this.network);
      let metas = await this.node.getMetaByAddrSH(
        addr, {limit: this.options.maxTxs, reverse: false});
      let txs = [];
      let balance = 0;
      for (let meta of metas){
        let view = await this.node.getMetaView(meta);
        const tx = meta.tx;
        const height = meta.height > 0 ? meta.height : null;
        const time = meta.time;
        // Calculate net result for this address (received - sent - fee if spender)
        let result = 0;
        let isSpender = false;
        for (const output of tx.outputs){
          if (output.address && output.address.equals(addr)){
            result += output.value;
            total_in += output.value;
          }
        }
        for (const input of tx.inputs){
          const coin = view.getCoinFor(input);
          if (coin && coin.address && coin.address.equals(addr)){
            result -= coin.value;
            total_out += coin.value;
          }
        }
        balance += result;
        const txJSON = {
          hash: tx.rhash(),
          ver: tx.version,
          vin_sz: tx.inputs.length,
          vout_sz: tx.outputs.length,
          size: tx.getSize(),
          weight: tx.getWeight(),
          fee: meta.fee,
          relayed_by: "0.0.0.0",
          lock_time: tx.locktime,
          tx_index: 0, // blockchain.info deprecated ID for fast TX DB lookup
          double_spend: false, // mempool double spend detection - TODO
          time: time,
          block_height: height,
          // block_index omitted (legacy)
          inputs: tx.inputs.map((input, idx)=>{
            const coin = view.getCoinFor(input);
            const prev = coin ? {
              spent: true,
              value: coin.value,
              n: coin.index,
              tx_index: 0,
              type: 0,
              script: coin.script.toASM(), // or toHex() if preferred
              addr: coin.address ? coin.address.toString(this.network) : null,
            } : {
              spent: false,
              value: 0,
              n: -1,
              tx_index: 0,
              type: 0,
              script: "",
              addr: null,
            };
            return {
              sequence: input.sequence,
              witness: tx.hasWitness() ? input.witness.toString() : "",
              script: input.script,
              index: idx,
              prev_out: prev,
            };
          }),
          out: tx.outputs.map((output, n)=>({
            type: 0,
            spent: false,  // Would require extra UTXO lookup per output
            value: output.value,
            n: n,
            tx_index: 0,
            script: output.script,
            addr: output.address ? output.address.toString(this.network) : null,
          })),
          result,
          balance,
        };
        txs.push(txJSON);
      }
      txs.reverse(); // Reverse to newest first
      const response = {
        address: address,
        hash160: addr.getHash().toString('hex'),
        n_tx: txs.length,
        total_received: total_in,
        total_sent: total_out,
        final_balance: balance,
        txs: txs,
      };
      res.json(200, response);
    });
    // Block by hash/height
    this.get('/block/:block', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      enforce(hash != null, 'Hash or height required.');
      enforce(!this.chain.options.spv, 'Cannot get block in SPV mode.');
      const block = await this.chain.getBlock(hash);
      if (!block)
        return void res.json(404);
      const view = await this.chain.getBlockView(block);
      if (!view)
        return void res.json(404);
      const height = await this.chain.getHeight(hash);
      const depth = this.chain.height - height + 1;
      res.json(200, block.getJSON(this.network, view, height, depth));
    });

    // blockstream.info API:
    // https://github.com/Blockstream/esplora/blob/master/API.md
    // blockstream.info client for wallet:
    // https://github.com/hwy419/bitcoin-wallet/blob/master/src/background/api/BlockstreamClient.ts

    // blockstream.info/api/address/bc1qannfxke2tfd4l7vhepehpvt05y83v3qsf6nfkk
    // localhost:8432/blockstream/address/lif1qannfxke2tfd4l7vhepehpvt05y83v3qs5e4jzp
    this.get('/blockstream/address/:address', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const address = valid.str('address');
      const limit = valid.uint('limit', this.options.maxTxs);
      const reverse = valid.bool('reverse', false);
      const after = valid.brhash('after', null);
      enforce(address, 'Address is required.');
      enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');
      enforce(limit <= this.options.maxTxs,
        `Limit above max of ${this.options.maxTxs}.`);
      const addr = Address.fromString(address, this.network);
      const addrsh = Script.fromAddress(addr).sha256();
      const metas = await this.node.getMetaByAddrSH(
        {addrsh}, {limit, reverse, after});
      let result = {address, ...blockstream_metas_sum(metas, addrsh)};
      res.json(200, result);
    });
    this.get('/blockstream/address/:address/txs', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const address = valid.str('address');
      const limit = valid.uint('limit', this.options.maxTxs);
      const reverse = valid.bool('reverse', false);
      const after = valid.brhash('after', null);
      enforce(address, 'Address is required.');
      enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');
      enforce(limit <= this.options.maxTxs,
        `Limit above max of ${this.options.maxTxs}.`);
      const addr = Address.fromString(address, this.network);
      const addrsh = Script.fromAddress(addr).sha256();
      const metas = await this.node.getMetaByAddrSH(
        {addrsh}, {limit, reverse, after});
      let txs = [];
      for (let meta of metas){
        let block = await this.chain.getBlock(meta.block);
        let view = await this.node.getMetaView(meta);
        let _tx = blockstream_tx(meta, view, block);
        txs.push(_tx);
      }
      res.json(200, txs);
    });
    // blockstream.info/api/scripthash/102c3b9d906f189a5c835c2ebac523f9f596582fb1ff0e721d4bb6539e207a4f
    // localhost:8432/blockstream/scripthash/102c3b9d906f189a5c835c2ebac523f9f596582fb1ff0e721d4bb6539e207a4f
    this.get('/blockstream/scripthash/:addrsh', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const _addrsh = valid.str('addrsh');
      const limit = valid.uint('limit', this.options.maxTxs);
      const reverse = valid.bool('reverse', false);
      const after = valid.brhash('after', null);
      enforce(_addrsh, 'AddrSH is required.');
      enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');
      enforce(limit <= this.options.maxTxs,
        `Limit above max of ${this.options.maxTxs}.`);
      const addrsh = Buffer.from(_addrsh, 'hex');
      const metas = await this.node.getMetaByAddrSH(
        {addrsh}, {limit, reverse, after});
      let result = {scripthash: _addrsh, ...blockstream_metas_sum(metas, addrsh)};
      res.json(200, result);
    });
    // Block hash by height
    this.get('/blockstream/block-height/:height', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const height = valid.uintbrhash('height');
      enforce(height != null, 'height required.');
      const block = await this.chain.getBlock(height);
      if (!block)
        return void res.json(404);
      res.text(200, util.revHex(block.hash()));
    });
    // Block status by hash/height
    this.get('/blockstream/block/:block/status', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      enforce(hash != null, 'Hash or height required.');
      enforce(!this.chain.options.spv, 'Cannot get block in SPV mode.');
      const block = await this.chain.getBlock(hash);
      if (!block)
        return void res.json(404);
      const height = await this.chain.getHeight(hash);
      const next = await this.chain.getNextHash(hash);
      let result = {
        height,
        in_best_chain: true, /*TODO*/
        next_best: next,
      };
      res.json(200, result);
    });
    this.get('/blockstream/tx/:tx', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.brhash('tx');
      enforce(hash, 'Hash is required.');
      const meta = await this.node.getMeta(hash);
      enforce(meta, 'meta not found for tx');
      const entry = await this.chain.getEntryByHeight(meta.height);
      const block = await this.chain.getBlock(entry.hash);
      let view = await this.node.getMetaView(meta);
      let result = blockstream_tx(meta, view, block);
      res.json(200, result);
    });
    this.get('/blockstream/tx/:tx/outspends', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.brhash('tx');
      enforce(hash, 'Hash is required.');
      const meta = await this.node.getMeta(hash);
      enforce(meta, 'meta not found for tx');
      let view = await this.node.getMetaView(meta);
      let tx = meta.tx;
      let result = await this.blockstream_tx_outspends(tx);
      res.json(200, result);
    });
    // TX in block
    this.get('/blockstream/block/:block/txs/:txi', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      const txi = valid.uint('txi');
      let limit = 25;
      enforce(hash != null, 'Hash or height required.');
      enforce(!this.chain.options.spv, 'Cannot get block in SPV mode.');
      const block = await this.chain.getBlock(hash);
      enforce(block, 'Block not found');
      enforce(block.txs.length>txi, 'txi '+txi+' out of block txs '+
        block.txs.length);
      let height = await this.chain.getHeight(hash);
      let next = await this.chain.getNextHash(hash);
      let txs = [];
      for (let i=txi, j=0; i<block.txs.length && j<limit; i++, j++){
        let tx = block.txs[i];
        let meta = await this.node.getMeta(tx.hash());
        let view = await this.node.getMetaView(meta);
        let _tx = blockstream_tx(meta, view, block);
        txs.push(_tx);
      }
      res.json(200, txs);
    });

    // chain tip height
    this.get('/blockstream/blocks/tip/height', async (req, res)=>{
      const height = this.chain.height;
      res.text(200, ''+height);
    });
    // last 10 block headers
    this.get('/blockstream/blocks', async (req, res)=>{
      let result = await this.blockstream_blocks();
      res.json(200, result);
    });
    this.get('/blockstream/blocks/:from', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const from = valid.u32('from');
      let result = await this.blockstream_blocks({from});
      res.json(200, result);
    });
    this.get('/blockstream/block/:block', async (req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      enforce(hash!=null, 'Hash or height required.');
      const block = await this.chain.getBlock(hash);
      if (!block)
        return void res.json(404);
      const height = await this.chain.getHeight(hash);
      const entry = await this.chain.getEntryByHeight(height);
      let result = blockstream_block_header(entry, block);
      res.json(200, result);
    });
    // last 10 txs
    this.get('/blockstream/mempool/recent', async (req, res)=>{
      /*{
        txid: "c8945137c3b57ee82b6d974ea528e09c331c9f8552a163c1ec34379ff5d4127e",
        fee: 423,
        vsize: 141,
        value: 133338640,
      }*/
      enforce(this.mempool, 'No mempool available.');
      let hashes = this.mempool.getSnapshot();
      let txs = [];
      for (const hash of hashes){
        let entry = this.mempool.getEntry(hash);
        let tx = entry.tx;
        let _tx = {
          txid: tx.rhash(),
          fee: entry.getFee(),
          vsize: entry.getVirtualSize(), 
          value: entry.getInputValue(),
        };
        txs.push(_tx);
      }
      txs = txs.slice(10);
      res.json(200, txs);
    });
    this.get('/blockstream/mempool', async (req, res)=>{
      enforce(this.mempool, 'No mempool available.');
      let hashes = this.mempool.getSnapshot();
      let txs = {count: 0, vsize: 0, total_fee: 0, fee_histogram: []};
      for (const hash of hashes){
        let entry = this.mempool.getEntry(hash);
        txs.count++;
        txs.vsize += entry.getVirtualSize();
        txs.total_fee += entry.getFee();
      }
      res.json(200, txs);
    });
    this.get('/blockstream/fee-estimates', async (req, res)=>{
      res.json(200, {"1": 1});
    });

    // Block Header by hash/height
    this.get('/header/:block', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      enforce(hash != null, 'Hash or height required.');
      const entry = await this.chain.getEntry(hash);
      if (!entry) {
        res.json(404);
        return;
      }
      res.json(200, entry.toJSON());
    });

    // Filters by hash/height
    this.get('/filter/:block', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');

      enforce(hash != null, 'Hash or height required.');

      const filter = await this.node.getBlockFilter(hash);

      if (!filter) {
        res.json(404);
        return;
      }

      res.json(200, filter.toJSON());
    });

    // Mempool snapshot
    this.get('/mempool', async (req, res) => {
      enforce(this.mempool, 'No mempool available.');

      const hashes = this.mempool.getSnapshot();
      const result = [];

      for (const hash of hashes)
        result.push(util.revHex(hash));

      res.json(200, result);
    });

    // Broadcast TX
    this.post('/broadcast', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const raw = valid.buf('tx');

      enforce(raw, 'TX is required.');

      const tx = TX.fromRaw(raw);

      await this.node.sendTX(tx);

      res.json(200, { success: true });
    });

    // Estimate fee
    this.get('/fee', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const blocks = valid.u32('blocks', 1);

      if (!this.fees) {
        res.json(200, { rate: this.network.feeRate });
        return;
      }

      const fee = this.fees.estimateFee(blocks);

      res.json(200, { rate: fee });
    });

    // Reset chain
    this.post('/reset', async (req, res) => {
      const valid = Validator.fromRequest(req);
      const height = valid.u32('height');

      enforce(height != null, 'Height is required.');
      enforce(height <= this.chain.height,
        'Height cannot be greater than chain tip.');

      await this.chain.reset(height);

      res.json(200, { success: true });
    });
  }

  /**
   * Handle new websocket.
   * @private
   * @param {WebSocketIO} socket
   */
  handleSocket(socket) {
    socket.hook('auth', (...args) => {
      if (socket.channel('auth'))
        throw new Error('Already authed.');
      if (!this.options.noAuth) {
        const valid = new Validator(args);
        const key = valid.str(0, '');
        if (key.length > 255)
          throw new Error('Invalid API key.');
        const data = Buffer.from(key, 'ascii');
        const hash = sha256.digest(data);
        if (!safeEqual(hash, this.options.apiHash))
          throw new Error('Invalid API key.');
      }
      socket.join('auth');
      this.logger.info('Successful auth from %s.', socket.host);
      this.handleAuth(socket);
      return null;
    });
    socket.fire('version', {
      version: pkg.version,
      network: this.network.type
    });
  }

  /**
   * Handle new auth'd websocket.
   * @private
   * @param {WebSocketIO} socket
   */
  handleAuth(socket) {
    socket.hook('watch chain', () => {
      socket.join('chain');
      return null;
    });
    socket.hook('unwatch chain', () => {
      socket.leave('chain');
      return null;
    });
    socket.hook('watch mempool', () => {
      socket.join('mempool');
      return null;
    });
    socket.hook('unwatch mempool', () => {
      socket.leave('mempool');
      return null;
    });
    socket.hook('set filter', (...args) => {
      const valid = new Validator(args);
      const data = valid.buf(0);
      if (!data)
        throw new Error('Invalid parameter.');
      socket.filter = BloomFilter.fromRaw(data);
      return null;
    });
    socket.hook('get tip', () => {
      return this.chain.tip.toRaw();
    });
    socket.hook('get entry', async (...args) => {
      const valid = new Validator(args);
      const block = valid.uintbrhash(0);
      if (block == null)
        throw new Error('Invalid parameter.');
      const entry = await this.chain.getEntry(block);
      if (!entry)
        return null;
      if (!await this.chain.isMainChain(entry))
        return null;
      return entry.toRaw();
    });
    socket.hook('get hashes', async (...args) => {
      const valid = new Validator(args);
      const start = valid.i32(0, -1);
      const end = valid.i32(1, -1);

      return this.chain.getHashes(start, end);
    });
    socket.hook('add filter', (...args) => {
      const valid = new Validator(args);
      const chunks = valid.array(0);
      if (!chunks)
        throw new Error('Invalid parameter.');
      if (!socket.filter)
        throw new Error('No filter set.');
      const items = new Validator(chunks);
      for (let i = 0; i < chunks.length; i++) {
        const data = items.buf(i);
        if (!data)
          throw new Error('Bad data chunk.');
        socket.filter.add(data);
        if (this.node.spv)
          this.pool.watch(data);
      }
      return null;
    });
    socket.hook('reset filter', () => {
      socket.filter = null;
      return null;
    });
    socket.hook('estimate fee', (...args) => {
      const valid = new Validator(args);
      const blocks = valid.u32(0);
      if (!this.fees)
        return this.network.feeRate;
      return this.fees.estimateFee(blocks);
    });
    socket.hook('send', (...args) => {
      const valid = new Validator(args);
      const data = valid.buf(0);
      if (!data)
        throw new Error('Invalid parameter.');
      const tx = TX.fromRaw(data);
      this.node.relay(tx);
      return null;
    });
    socket.hook('rescan', (...args) => {
      const valid = new Validator(args);
      const start = valid.uintbrhash(0);
      if (start == null)
        throw new Error('Invalid parameter.');
      return this.scan(socket, start);
    });
    socket.hook('abortrescan', () => {
      return this.chain.abortRescan();
    });
  }

  /**
   * Bind to chain events.
   * @private
   */
  initSocketIO() {
    const pool = this.mempool || this.pool;
    this.chain.on('connect', (entry, block, view) => {
      const sockets = this.channel('chain');
      if (!sockets)
        return;
      const raw = entry.toRaw();
      this.to('chain', 'chain connect', raw);
      for (const socket of sockets) {
        const txs = this.filterBlock(socket, block);
        socket.fire('block connect', raw, txs);
      }
    });
    this.chain.on('disconnect', (entry, block, view) => {
      const sockets = this.channel('chain');
      if (!sockets)
        return;
      const raw = entry.toRaw();
      this.to('chain', 'chain disconnect', raw);
      this.to('chain', 'block disconnect', raw);
    });
    this.chain.on('reset', (tip) => {
      const sockets = this.channel('chain');
      if (!sockets)
        return;
      this.to('chain', 'chain reset', tip.toRaw());
    });
    pool.on('tx', (tx) => {
      const sockets = this.channel('mempool');
      if (!sockets)
        return;
      const raw = tx.toRaw();
      for (const socket of sockets) {
        if (!this.filterTX(socket, tx))
          continue;
        socket.fire('tx', raw);
      }
    });
  }

  /**
   * Filter block by socket.
   * @private
   * @param {SocketIO} socket
   * @param {Block} block
   * @returns {TX[]}
   */

  filterBlock(socket, block) {
    if (!socket.filter)
      return [];

    const txs = [];

    for (const tx of block.txs) {
      if (this.filterTX(socket, tx))
        txs.push(tx.toRaw());
    }

    return txs;
  }

  /**
   * Filter transaction by socket.
   * @private
   * @param {SocketIO} socket
   * @param {TX} tx
   * @returns {Boolean}
   */

  filterTX(socket, tx) {
    if (!socket.filter)
      return false;

    let found = false;

    for (let i = 0; i < tx.outputs.length; i++) {
      const output = tx.outputs[i];
      const hash = output.getHash();

      if (!hash)
        continue;

      if (socket.filter.test(hash)) {
        const prevout = Outpoint.fromTX(tx, i);
        socket.filter.add(prevout.toRaw());
        found = true;
      }
    }

    if (found)
      return true;

    if (!tx.isCoinbase()) {
      for (const {prevout} of tx.inputs) {
        if (socket.filter.test(prevout.toRaw()))
          return true;
      }
    }

    return false;
  }

  /**
   * Scan using a socket's filter.
   * @private
   * @param {SocketIO} socket
   * @param {Hash} start
   * @returns {Promise}
   */

  async scan(socket, start) {
    if (!socket.filter)
      return null;

    await this.node.scan(start, socket.filter, (entry, txs) => {
      const block = entry.toRaw();
      const raw = [];

      for (const tx of txs)
        raw.push(tx.toRaw());

      return socket.call('block rescan', block, raw);
    });
    return null;
  }

  init_electrum(){
    // https://electrumx.readthedocs.io/en/latest/protocol-methods.html
    const ws_server = new WebSocketServer({server: this.http, path: '/' });
    let ws_rpc = new WebSocketServer_json_rpc({ws_server});
    ws_rpc.method('server.version', ()=>['lifcoin', '1.4']);
    ws_rpc.method('server.banner', ()=>'lifcoin');
    ws_rpc.method('server.ping', ()=>null);
    ws_rpc.method('server.features', ()=>{
      let network = this.network;
      let res = {
        genesis_hash: util.revHex(network.genesis.hash),
        protocol_max: '1.0',
        protocol_min: '1.0',
        pruning: null,
        server_version: 'lifcoin ElectrumX '+pkg.version,
        hash_function: 'sha256',
        hash_function_pow: network.pow_hash256_name=='hash256lif' ?
          'sha256lif' : 'sha256',
        network: network.type,
      };
      return res;
    });
    ws_rpc.method('server.donation_address',
      ()=>this.miner.getAddress().toString(this.network));
    ws_rpc.method('blockchain.scripthash.get_balance', arg=>{
      // Also via HTTP:
      // https://blockstream.info/api/scripthash/6191c3b590bfcfa0475e877c302da1e323497acf3b42c08d8fa28e364edf018b/txs
      // Extract scriptPubKey bytes

      // Compute SHA256 and reverse for Electrum scripthash
      //const scriptPubKey = output.script.toRaw();
      //const hash = bcrypto.sha256(scriptPubKey);
      //const scripthash = hash.reverse().toString('hex');
    });
  }

  async lookup_spend_tx(hash, i){}
  async blockstream_tx_outspends(tx){
    let spends = [];
    for (let i=0; i<tx.outputs.length; i++){
      let coin = await this.node.chain.getCoin(tx.hash(), i);
      if (coin){
        spends.push({spent: false});
        continue;
      }
      // TODO: add indexing for spent output to locate their inputs
      spends.push({spent: true, txid: '', vin: 0,
        status: {confirmed: true, block_height: 0, block_hash: '', block_time: 0}});
      continue;
      let {txid, vin, block} = await this.lookup_spend_tx(tx.hash(), i);
      spends.push({
        spent: true,
        txid: txid.rhash(),
        vin: vin,
        status: blockstream_block_status(block),
      });
    }
    return spends;
  }
  async blockstream_blocks(opt={}){
    const height = this.chain.height;
    let from = opt.from==null ? this.chain.height : opt.from;
    let limit = opt.limit||10;
    let entries = [];
    for (let i=from, j=0; i>=0 && j<limit; i--, j++){
      const entry = await this.chain.getEntryByHeight(i);
      const block = await this.chain.getBlock(entry.hash);
      let _entry = blockstream_block_header(entry, block);
      entries.push(_entry);
    }
    return entries;
  }
}

class HTTPOptions {
  /**
   * HTTPOptions
   * @alias module:http.HTTPOptions
   * @constructor
   * @param {Object} options
   */

  constructor(options) {
    this.network = Network.primary;
    this.logger = null;
    this.node = null;
    this.apiKey = base58.encode(random.randomBytes(20));
    this.apiHash = sha256.digest(Buffer.from(this.apiKey, 'ascii'));
    this.noAuth = false;
    this.cors = false;
    this.maxTxs = 100;

    this.prefix = null;
    this.host = '127.0.0.1';
    this.port = 8080;
    this.ssl = false;
    this.keyFile = null;
    this.certFile = null;

    this.fromOptions(options);
  }

  /**
   * Inject properties from object.
   * @private
   * @param {Object} options
   * @returns {HTTPOptions}
   */

  fromOptions(options) {
    assert(options);
    assert(options.node && typeof options.node === 'object',
      'HTTP Server requires a Node.');

    this.node = options.node;
    this.network = options.node.network;
    this.logger = options.node.logger;

    this.port = this.network.rpcPort;

    if (options.logger != null) {
      assert(typeof options.logger === 'object');
      this.logger = options.logger;
    }

    if (options.apiKey != null) {
      assert(typeof options.apiKey === 'string',
        'API key must be a string.');
      assert(options.apiKey.length <= 255,
        'API key must be under 256 bytes.');
      this.apiKey = options.apiKey;
      this.apiHash = sha256.digest(Buffer.from(this.apiKey, 'ascii'));
    }

    if (options.noAuth != null) {
      assert(typeof options.noAuth === 'boolean');
      this.noAuth = options.noAuth;
    }

    if (options.cors != null) {
      assert(typeof options.cors === 'boolean');
      this.cors = options.cors;
    }

    if (options.prefix != null) {
      assert(typeof options.prefix === 'string');
      this.prefix = options.prefix;
      this.keyFile = path.join(this.prefix, 'key.pem');
      this.certFile = path.join(this.prefix, 'cert.pem');
    }

    if (options.host != null) {
      assert(typeof options.host === 'string');
      this.host = options.host;
    }

    if (options.port != null) {
      assert((options.port & 0xffff) === options.port,
        'Port must be a number.');
      this.port = options.port;
    }

    if (options.ssl != null) {
      assert(typeof options.ssl === 'boolean');
      this.ssl = options.ssl;
    }

    if (options.keyFile != null) {
      assert(typeof options.keyFile === 'string');
      this.keyFile = options.keyFile;
    }

    if (options.certFile != null) {
      assert(typeof options.certFile === 'string');
      this.certFile = options.certFile;
    }

    if (options.maxTxs != null) {
      assert(Number.isSafeInteger(options.maxTxs));
      this.maxTxs = options.maxTxs;
    }

    // Allow no-auth implicitly
    // if we're listening locally.
    if (!options.apiKey) {
      if (this.host === '127.0.0.1' || this.host === '::1')
        this.noAuth = true;
    }

    if (options.sockets != null)
      this.sockets = options.sockets;

    return this;
  }

  /**
   * Instantiate http options from object.
   * @param {Object} options
   * @returns {HTTPOptions}
   */

  static fromOptions(options) {
    return new HTTPOptions().fromOptions(options);
  }
}

/*
 * Helpers
 */

function enforce(value, msg) {
  if (!value) {
    const err = new Error(msg);
    err.statusCode = 400;
    throw err;
  }
}

class WebSocketServer_json_rpc extends EventEmitter {
  constructor(opt){
    super();
    this.methods = {};
    this.ws_server = opt.ws_server;
    this.init();
  }
  init(){
    this.ws_server.on('connection', ws=>{
      console.log(`New WebSocket client connected`);
      this.init_conn(ws);
    });
   }
   init_conn(ws){
    ws.send_json = function(json){
      let s = JSON.stringify(json);
      console.log(`Sent: ${s}`);
      this.send(s);
    };
    ws.send_res = function(res){
      let response = {
        jsonrpc: '2.0',
        id: res.id!==undefined ? res.id : null,
      };
      if (res.error!==null)
        response.error = res.error;
      else
        response.result = res.result;
      this.send_json(response);
    };
    ws.on('message', async(message)=>{
      console.log(`Received: ${message}`);
      let req;
      try {
        req = JSON.parse(message.toString());
      } catch (err){
        return void ws.send_res({error: 'parse error'});
      }
      let fn;
      if (!('jsonrpc' in req))
        return void ws.send_res({error: 'not jsonrpc'});
      if (typeof req.jsonrpc!='string')
        return void ws.send_res({error: 'invalid jsonrpc version'});
      if (!('params' in req))
        return void ws.send_res({error: 'params missing'});
      if (!('method' in req))
        return void ws.send_res({error: 'params missing'});
      if (!(fn=this.methods[req.method]))
        return void ws.send_res({error: 'method missing: '+req.method});
      let ret;
      try {
        ret = await fn(req.params);
      } catch(err){
        console.error('${message} failed: '+err);
        if (req.id!=null)
          ws.send_res({error: 'failed: '+err});
        return;
      }
      if (req.id==null)
        return;
      ws.send_json({result: ret, id: req.id});
    });
    ws.on('close', ()=>{
      console.log('Client disconnected');
    });
    ws.on('error', err=>{
      console.error('WebSocket error:', err);
    });
  }
  method(method, fn){
    assert(!this.methods[method]);
    this.methods[method] = fn;
  }
}

/*
  blockstream_block_header_entry = {
    id: "000000000000000000000a19e25c12dc465ec58b51debc5d7c6f3ca97074b065",
    height: 930776,
    version: 613007360,
    timestamp: 1767477589,
    tx_count: 3082,
    size: 1532314,
    weight: 3526009,
    merkle_root: "e2111877050c3f05b01775fd2b622368f2120b7d6d1f38dfcba682674bbb6c63",
    previousblockhash: "0000000000000000000051fafcee5a3772d525b6c17567cca80e2fc313c2857f",
    mediantime: 1767473567,
    nonce: 3726934430,
    bits: 386000389,
    difficulty: 148258433855481,
  };
  bcoin_entry = {
    bits: 520159231,
    chainwork: "0000000000000000000000000000000000000000000000000000000000010001",
    hash: "0000705e1975caff9d3836b6d56771c38003d6e2364f6ea440f611385c2c62db",
    height: 0,
    merkleRoot: "3086b2480c3f41128cb04ca85017b3a2161691fe2b222fc7387f3e48de098a09",
    nonce: 29664,
    prevBlock: "0000000000000000000000000000000000000000000000000000000000000000",
    time: 1753572481,
    version: 1,
  };
*/
function blockstream_block_header(entry, block){
  return {
    id: entry.rhash(),
    height: entry.height,
    version: entry.version,
    timestamp: entry.time,
    tx_count: block.txs.length,
    size: block.getSize(),
    weight: block.getWeight(),
    merkle_root: util.revHex(entry.merkleRoot),
    previousblockhash: util.revHex(entry.prevBlock),
    mediantime: entry.time, // TODO
    nonce: entry.nonce,
    bits: entry.bits,
    difficulty: toDifficulty(entry.bits),
  };
}

function blockstream_tx_vout(tx){
  return tx.outputs.map((output, n)=>{
    let addr = output.getAddress();
    let _tx = {
      type: 0,
      spent: false, // Would require extra UTXO lookup per output
      value: output.value,
      n: n,
      tx_index: 0,
      scriptpubkey: output.script, /*TODO*/
      scriptpubkey_asm: output.script.toASM(),
      scriptpubkey_type: Script.typesByVal[output.script.getType()], /* TODO */
      scriptpubkey_address: addr ? addr.toString() : null,
    };
    return _tx;
  });
}

function blockstream_tx_vin(meta, view){
  let tx = meta.tx;
  return tx.inputs.map((input, idx)=>{
    let coin = view.getCoinFor(input);
    let prev = coin ? {
      spent: true,
      value: coin.value,
      n: coin.index,
      tx_index: 0,
      type: 0,
      script: coin.script.toASM(), // or toHex() if preferred
      addr: coin.address ? coin.address.toString(this.network) : null,
    } : null;
    return {
      sequence: input.sequence,
      witness: tx.hasWitness() ? [input.witness.toString()] : [],
      scriptsig: input.script,
      scriptsig_asm: input.script.toASM(),
      is_coinbase: idx==0,
      index: idx,
      prevout: prev,
    };
  });
}

function blockstream_block_status(block){
  return {
    confirmed: true, /*TODO*/
    block_height: block.height,
    block_hash: util.revHex(block.hash()),
    block_time: block.time,
  };
}

function blockstream_tx(meta, view, block){
   let tx = meta.tx;
   return {
    txid: tx.rhash(),
    version: tx.version,
    locktime: tx.locktime,
    size: tx.getSize(),
    weight: tx.getWeight(),
    fee: meta.fee,
    vin: blockstream_tx_vin(meta, view),
    vout: blockstream_tx_vout(tx),
    status: blockstream_block_status(block),
  };
}

function blockstream_metas_sum(metas, addrsh){
  let result = {
    chain_stats: {
      funded_txo_count: 0,
      funded_txo_sum: 0,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 0,
    },
    mempool_stats: {
      funded_txo_count: 0,
      funded_txo_sum: 0,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 0,
    },
  };
  for (const meta of metas){
    let to = meta.block ? result.chain_stats : result.mempool_stats;
    to.tx_count++;
    to.funded_txo_count++;
    for (const out of meta.tx.outputs){
      if (out.script.sha256().compare(addrsh))
        continue;
      to.funded_txo_sum += out.value;
    }
    // XXX TODO spent_txo_count - when DB will include spending TX
  }
  return result;
}

function toDifficulty(bits){
  let shift = (bits >>> 24) & 0xff;
  let diff = 0x0000ffff / (bits & 0x00ffffff);
  while (shift < 29){
    diff *= 256.0;
    shift++;
  }
  while (shift > 29){
    diff /= 256.0;
    shift--;
  }
  return diff;
}

/*
 * Expose
 */

module.exports = HTTP;
