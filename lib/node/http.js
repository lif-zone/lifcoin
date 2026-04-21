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
const {revHex, now} = require('../utils/util');
const Address = require('../primitives/address');
const TX = require('../primitives/tx');
const Coin = require('../primitives/coin');
const Outpoint = require('../primitives/outpoint');
const Network = require('../protocol/network');
const Script = require('../script/script');
const Miner = require('../mining/miner');
const pkg = require('../pkg');
const {WebSocketServer} = require('ws');
const {OF, crit_err}= require('../utils/util');

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

  initRouter(){
    if (this.options.cors){
      //this.use(this.cors());
      this.use(async(req, res)=>{
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods',
          'GET,HEAD,PUT,PATCH,POST,DELETE');
        res.setHeader('Access-Control-Allow-Headers',
          '*'); //'Authorization,Content-Type,User-Agent');
        if (req.method=='OPTIONS'){
          res.setStatus(200);
          res.end();
          return;
        }
      });
    }
    if (!this.options.noAuth){
      this.use(this.basicAuth({
        hash: sha256.digest,
        password: this.options.apiKey,
        realm: 'node',
      }));
    }
    this.use(this.bodyParser({
      type: 'json'
    }));
    this.use(this.jsonRPC());
    this.use(this.router());
    this.error((err, req, res)=>{
      const code = err.statusCode || 500;
      res.json(code, {
        error: {
          type: err.type,
          code: err.code,
          message: err.message,
        }
      });
    });
    this.get('/', async(req, res)=>{
      const totalTX = this.mempool ? this.mempool.map.size : 0;
      const size = this.mempool ? this.mempool.getSize() : 0;
      const orphans = this.mempool ? this.mempool.orphans.size : 0;
      let addr = this.pool.hosts.getLocal();
      const filter = {};
      for (const type of this.node.filterIndexers.keys()){
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
          system: now(),
          adjusted: this.network.now(),
          offset: this.network.time.offset
        },
        memory: this.logger.memoryUsage()
      });
    });

    // UTXO by addr
    this.get('/coin/address/:address', async(req, res)=>{
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
        for (let i=0; i<m.tx.outputs.length; i++){
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
    this.get('/coin/:hash/:index', async(req, res)=>{
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
    this.get('/tx/:hash', async(req, res)=>{
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
    this.get('/tx/address/:address', async(req, res)=>{
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
    // https://open-api.unisat.io/
    // https://www.blockchain.com/explorer/api/blockchain_api
    // TX by address - blockchain.info api
    // https://blockchain.info/rawaddr/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh
    this.get('/blockchain.info/rawaddr/:address', async(req, res)=>{
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
        addr, {limit: this.options.maxTxs});
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
              script: coin.script.toASM(),
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
    this.get('/block/:block', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      enforce(hash != null, 'Hash or height required.');
      enforce(!this.chain.options.spv, 'Cannot get block in SPV mode.');
      const block = await this.chain.getBlock(hash);
      if (!block)
        return res.text(404, 'block not found');
      const view = await this.chain.getBlockView(block);
      if (!view)
        return res.json(404);
      const height = await this.chain.getHeight(hash);
      const depth = this.chain.height - height + 1;
      res.json(200, block.getJSON(this.network, view, height, depth));
    });

    // blockstream.info API:
    // https://github.com/Blockstream/esplora/blob/master/API.md
    // blockstream.info client for wallet:
    // https://github.com/hwy419/bitcoin-wallet/blob/master/src/background/api/BlockstreamClient.ts
    let get_addr_addrsh = (req)=>{
      let valid = Validator.fromRequest(req);
      let addr, _addr = valid.str('address');
      let addrsh, _addrsh = valid.str('addrsh');
      enforce(_addr || _addrsh, 'address/schriphash required');
      if (_addr.length==64){
        _addrsh = _addr;
        _addr = null;
      }
      if (_addr){
        addr = Address.fromString(_addr, this.network);
        addrsh = Script.fromAddress(addr).sha256();
      } else
        addrsh = Buffer.from(_addrsh, 'hex');
      return {addr, _addr, addrsh, _addrsh};
    };
    let blockstream_address = async(req, res)=>{
      let valid = Validator.fromRequest(req);
      let limit = valid.uint('limit', this.options.maxTxs);
      let reverse = valid.bool('reverse', false);
      let after = valid.brhash('after', null);
      enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');
      enforce(limit <= this.options.maxTxs,
        `Limit above max of ${this.options.maxTxs}.`);
      let a = get_addr_addrsh(req);
      let metas = await this.node.getMetaByAddrSH(
        {addrsh: a.addrsh}, {limit, reverse, after});
      let sum = blockstream_metas_sum(metas, a.addrsh);
      if (a.addr)
        sum.address = a._addr;
      else
        sum.scripthash = a._addrsh;
      let v = await this.lif_kv_metas_sum(metas, a.addrsh);
      if (v)
        sum.lif_kv = v;
      res.json(200, sum);
    };
    // blockstream.info/api/address/bc1qannfxke2tfd4l7vhepehpvt05y83v3qsf6nfkk
    // localhost:8432/blockstream/address/lif1qannfxke2tfd4l7vhepehpvt05y83v3qs5e4jzp
    this.get('/blockstream/address/:address', async(req, res)=>{
      return await blockstream_address(req, res);
    });
    // blockstream.info/api/scripthash/102c3b9d906f189a5c835c2ebac523f9f596582fb1ff0e721d4bb6539e207a4f
    // localhost:8432/blockstream/scripthash/102c3b9d906f189a5c835c2ebac523f9f596582fb1ff0e721d4bb6539e207a4f
    this.get('/blockstream/scripthash/:addrsh', async(req, res)=>{
      return await blockstream_address(req, res);
    });
    let blockstream_address_txs = async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const limit = valid.uint('limit', this.options.maxTxs);
      const reverse = valid.bool('reverse', false);
      const after = valid.brhash('after', null);
      enforce(!this.chain.options.spv, 'Cannot get TX in SPV mode.');
      enforce(limit <= this.options.maxTxs,
        `Limit above max of ${this.options.maxTxs}.`);
      let a = get_addr_addrsh(req);
      const metas = await this.node.getMetaByAddrSH(
        {addrsh: a.addrsh}, {limit, reverse, after});
      let txs = [];
      for (let meta of metas)
        txs.push(await this.blockstream_tx(meta.tx));
      res.json(200, txs);
    };
    this.get('/blockstream/address/:address/txs', async(req, res)=>{
      return blockstream_address_txs(req, res);
    });
    this.get('/blockstream/scripthash/:addrsh/txs', async(req, res)=>{
      return blockstream_address_txs(req, res);
    });
    // Block hash by height
    this.get('/blockstream/block-height/:height', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const height = valid.uintbrhash('height');
      enforce(height != null, 'height required.');
      const block = await this.chain.getBlock(height);
      if (!block)
        return res.text(404, 'block not found');
      res.text(200, block.rhash());
    });
    // Block status by hash/height
    this.get('/blockstream/block/:block/status', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      enforce(hash != null, 'Hash or height required.');
      enforce(!this.chain.options.spv, 'Cannot get block in SPV mode.');
      const block = await this.chain.getBlock(hash);
      if (!block)
        return res.text(404, 'block not found');
      const height = await this.chain.getHeight(hash);
      const next = await this.chain.getNextHash(hash);
      let result = {
        height,
        in_best_chain: true, /*TODO*/
        next_best: next,
      };
      res.json(200, result);
    });
    this.get('/blockstream/tx/:tx', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.brhash('tx');
      enforce(hash, 'Hash is required.');
      const meta = await this.node.getMeta(hash);
      if (!meta)
        return res.text(404, 'transaction not found');
      let result = await this.blockstream_tx(meta.tx);
      res.json(200, result);
    });
    this.get('/blockstream/tx/:tx/outspends', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.brhash('tx');
      enforce(hash, 'Hash is required.');
      const meta = await this.node.getMeta(hash);
      if (!meta)
        return res.text(404, 'transaction not found');
      let result = await this.blockstream_tx_outspends(meta);
      res.json(200, result);
    });
    // TX in block
    this.get('/blockstream/block/:block/txs/:txi', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      const txi = valid.uint('txi');
      let limit = 25;
      enforce(hash != null, 'Hash or height required.');
      enforce(!this.chain.options.spv, 'Cannot get block in SPV mode.');
      const block = await this.chain.getBlock(hash);
      if (!block)
        return res.text(404, 'block not found');
      enforce(block.txs.length>txi, 'txi '+txi+' out of block txs '+
        block.txs.length);
      let height = await this.chain.getHeight(hash);
      let next = await this.chain.getNextHash(hash);
      let txs = [];
      for (let i=txi, j=0; i<block.txs.length && j<limit; i++, j++){
        let tx = block.txs[i];
        txs.push(await this.blockstream_tx(tx));
      }
      res.json(200, txs);
    });

    // chain tip height
    this.get('/blockstream/blocks/tip/height', async(req, res)=>{
      let height = this.chain.height;
      res.text(200, ''+height);
    });
    // last 10 block headers
    this.get('/blockstream/blocks', async(req, res)=>{
      let result = await this.blockstream_blocks();
      res.json(200, result);
    });
    this.get('/blockstream/blocks/:from', async(req, res)=>{
      let valid = Validator.fromRequest(req);
      let from = valid.u32('from');
      let result = await this.blockstream_blocks({from});
      res.json(200, result);
    });
    // https://blockstream.info/api/block/00000000000000000001154dc4376d567cd470828eb63f79914ef4e692e17108
    this.get('/blockstream/block/:block', async(req, res)=>{
      let valid = Validator.fromRequest(req);
      let hash = valid.uintbrhash('block');
      enforce(hash!=null, 'Hash or height required.');
      let block = await this.chain.getBlock(hash);
      if (!block)
        return res.json(404);
      let height = await this.chain.getHeight(hash);
      let entry = await this.chain.getEntryByHeight(height);
      let result = blockstream_block_header(entry, block);
      res.json(200, result);
    });
    // last 10 txs
    this.get('/blockstream/mempool/recent', async(req, res)=>{
      enforce(this.mempool, 'No mempool available.');
      let hashes = this.mempool.getSnapshot();
      let txs = [];
      for (const hash of hashes){
        let meta = this.mempool.getMeta(hash);
        let tx = meta.tx;
        let view = await this.mempool.getCoinView(tx);
        let _tx = {
          txid: tx.rhash(),
          fee: tx.getFee(view),
          vsize: tx.getVirtualSize(), 
          value: tx.getInputValue(view),
        };
        txs.push(_tx);
      }
      txs = txs.slice(0, 10);
      res.json(200, txs);
    });
    this.get('/blockstream/mempool', async(req, res)=>{
      enforce(this.mempool, 'No mempool available.');
      let hashes = this.mempool.getSnapshot();
      let txs = {count: 0, vsize: 0, total_fee: 0, fee_histogram: []};
      for (const hash of hashes){
        let meta = this.mempool.getMeta(hash);
        let tx = meta.tx;
        let view = await this.mempool.getCoinView(tx);
        txs.count++;
        txs.vsize += tx.getVirtualSize();
        txs.total_fee += tx.getFee(view);
      }
      res.json(200, txs);
    });
    this.get('/blockstream/fee-estimates', async(req, res)=>{
      res.json(200, {"1": 1});
    });

    // Block Header by hash/height
    this.get('/header/:block', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      enforce(hash != null, 'Hash or height required.');
      const entry = await this.chain.getEntry(hash);
      if (!entry)
        return res.json(404);
      res.json(200, entry.toJSON());
    });
    // Filters by hash/height
    this.get('/filter/:block', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const hash = valid.uintbrhash('block');
      enforce(hash != null, 'Hash or height required.');
      const filter = await this.node.getBlockFilter(hash);
      if (!filter)
        return res.json(404);
      res.json(200, filter.toJSON());
    });
    // Mempool snapshot
    this.get('/mempool', async(req, res)=>{
      enforce(this.mempool, 'No mempool available.');
      const hashes = this.mempool.getSnapshot();
      const result = [];
      for (const hash of hashes)
        result.push(revHex(hash));
      res.json(200, result);
    });
    // Broadcast TX
    this.post('/broadcast', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const raw = valid.buf('tx');
      enforce(raw, 'TX is required.');
      const tx = TX.fromRaw(raw);
      await this.node.sendTX(tx);
      res.json(200, {success: true});
    });
    // Estimate fee
    this.get('/fee', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const blocks = valid.u32('blocks', 1);
      if (!this.fees)
        return void res.json(200, {rate: this.network.feeRate});
      const fee = this.fees.estimateFee(blocks);
      res.json(200, {rate: fee});
    });
    // Reset chain
    this.post('/reset', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const height = valid.u32('height');
      enforce(height != null, 'Height is required.');
      enforce(height <= this.chain.height,
        'Height cannot be greater than chain tip.');
      await this.chain.reset(height);
      res.json(200, {success: true});
    });
    this.post('/reset_mempool', async(req, res)=>{
      await this.mempool.reset();
      res.json(200, {success: true});
    });
    // Mine a block on the chain
    this.post('/mine', async(req, res)=>{
      let miner = new Miner({chain: this.chain, mempool: this.mempool});
      let mine_address = this.node.config.array('coinbase-address')[0];
      let miningAddress = new Address(mine_address);
      console.log(`Mining to address: ${mine_address}`);
      let job = await miner.cpu.createJob(null, miningAddress);
      // Mine blocks all ten minutes apart from regtest genesis
      //job.attempt.time = chain.tip.time + (60 * 10); // fake time
      let block = await job.mineAsync();
      let entry = await this.chain.add(block);
      console.log(`Mined block: ${block.hash().toString('hex')}`);
      res.json(200, {success: true});
    });
    // LIF KV
    this.get('/lif_kv', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const key = valid.str('key');
      let kv = await this.node.lif_kv_get(key);
      res.json(200, kv);
    });
    this.get('/lif_kv_vals', async(req, res)=>{
      const valid = Validator.fromRequest(req);
      const key = valid.str('key');
      let vals = await this.node.lif_kv_get_vals(key);
      res.json(200, vals);
    });
  }

  /**
   * Handle new websocket.
   * @private
   * @param {WebSocketIO} socket
   */
  handleSocket(socket){
    socket.hook('auth', (...args)=>{
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
      network: this.network.type,
    });
  }

  /**
   * Handle new auth'd websocket.
   * @private
   * @param {WebSocketIO} socket
   */
  handleAuth(socket){
    socket.hook('watch chain', ()=>{
      socket.join('chain');
    });
    socket.hook('unwatch chain', ()=>{
      socket.leave('chain');
    });
    socket.hook('watch mempool', ()=>{
      socket.join('mempool');
    });
    socket.hook('unwatch mempool', ()=>{
      socket.leave('mempool');
    });
    socket.hook('set filter', (...args)=>{
      const valid = new Validator(args);
      const data = valid.buf(0);
      if (!data)
        throw new Error('Invalid parameter.');
      socket.filter = BloomFilter.fromRaw(data);
    });
    socket.hook('get tip', () => {
      return this.chain.tip.toRaw();
    });
    socket.hook('get entry', async (...args)=>{
      const valid = new Validator(args);
      const block = valid.uintbrhash(0);
      if (block==null)
        throw new Error('Invalid parameter.');
      const entry = await this.chain.getEntry(block);
      if (!entry)
        return;
      if (!await this.chain.isMainChain(entry))
        return;
      return entry.toRaw();
    });
    socket.hook('get hashes', async(...args)=>{
      const valid = new Validator(args);
      const start = valid.i32(0, -1);
      const end = valid.i32(1, -1);
      return this.chain.getHashes(start, end);
    });
    socket.hook('add filter', (...args)=>{
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
    });
    socket.hook('reset filter', ()=>{
      socket.filter = null;
    });
    socket.hook('estimate fee', (...args)=>{
      const valid = new Validator(args);
      const blocks = valid.u32(0);
      if (!this.fees)
        return this.network.feeRate;
      return this.fees.estimateFee(blocks);
    });
    socket.hook('send', (...args)=>{
      const valid = new Validator(args);
      const data = valid.buf(0);
      if (!data)
        throw new Error('Invalid parameter.');
      const tx = TX.fromRaw(data);
      this.node.relay(tx);
    });
    socket.hook('rescan', (...args)=>{
      const valid = new Validator(args);
      const start = valid.uintbrhash(0);
      if (start == null)
        throw new Error('Invalid parameter.');
      return this.scan(socket, start);
    });
    socket.hook('abortrescan', ()=>{
      return this.chain.abortRescan();
    });
  }

  /**
   * Bind to chain events.
   * @private
   */
  initSocketIO(){
    const pool = this.mempool || this.pool;
    this.chain.on('connect', (entry, block, view)=>{
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
    this.chain.on('disconnect', (entry, block, view)=>{
      const sockets = this.channel('chain');
      if (!sockets)
        return;
      const raw = entry.toRaw();
      this.to('chain', 'chain disconnect', raw);
      this.to('chain', 'block disconnect', raw);
    });
    this.chain.on('reset', (tip)=>{
      const sockets = this.channel('chain');
      if (!sockets)
        return;
      this.to('chain', 'chain reset', tip.toRaw());
    });
    pool.on('tx', (tx)=>{
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
  filterBlock(socket, block){
    if (!socket.filter)
      return [];
    const txs = [];
    for (const tx of block.txs){
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
  filterTX(socket, tx){
    if (!socket.filter)
      return false;
    let found = false;
    for (let i = 0; i < tx.outputs.length; i++){
      const output = tx.outputs[i];
      const hash = output.getHash();
      if (!hash)
        continue;
      if (socket.filter.test(hash)){
        const prevout = Outpoint.fromTX(tx, i);
        socket.filter.add(prevout.toRaw());
        found = true;
      }
    }
    if (found)
      return true;
    if (!tx.isCoinbase()){
      for (const {prevout} of tx.inputs){
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
  async scan(socket, start){
    if (!socket.filter)
    await this.node.scan(start, socket.filter, (entry, txs) => {
      const block = entry.toRaw();
      const raw = [];
      for (const tx of txs)
        raw.push(tx.toRaw());
      return socket.call('block rescan', block, raw);
    });
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
        genesis_hash: revHex(network.genesis.hash),
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
    function electrum_addrsh(sh){
      // electrum reverses the scripthash
      return Buffer.from(sh, 'hex').reverse();
    }
    ws_rpc.method('blockchain.scripthash.get_balance', async([sh])=>{
      let bal = {confirmed: 0, unconfirmed: 0};
      let addrsh = electrum_addrsh(sh);
      let metas = await this.node.getMetaByAddrSH({addrsh});
      let sum = blockstream_metas_sum(metas, addrsh);
      bal.confirmed += sum.chain_stats.funded_txo_sum
        -sum.chain_stats.spent_txo_sum;
      bal.unconfirmed += sum.mempool_stats.funded_txo_sum
        -sum.mempool_stats.spent_txo_sum;
      let v = await this.lif_kv_metas_sum(metas, addrsh);
      if (v)
        bal.lif_kv = v;
      return bal;
    });
    function height_cmp(a, b){
      // put mempool txs last
      let ha = a.height<=0 ? 1000000000 : a.height;
      let hb = b.height<=0 ? 1000000000 : b.height;
      return ha-hb;
    }
    ws_rpc.method('blockchain.scripthash.get_history', async([sh])=>{
      let history = [];
      let addrsh = electrum_addrsh(sh);
      let metas = await this.node.getMetaByAddrSH({addrsh});
      for (const meta of metas){
        let tx = meta.tx;
        let h = {height: meta.height, tx_hash: tx.rhash()};
        let lif_kv = await this.node.lif_kv_tx_get(tx.hash());
        for (let i=0; i<tx.outputs.length; i++){
          let out = tx.outputs[i];
          if (out.script.sha256().compare(addrsh))
            continue;
          if (lif_kv?.[i]){
            h.lif_kv ||= [];
            h.lif_kv.push(...lif_kv[i]);
          }
          h.spent = (await this.spend_get(meta, i)).spent;
        }
        history.push(h);
      }
      history.sort(height_cmp);
      return history;
    });
    ws_rpc.method('blockchain.scripthash.listunspent', async([sh])=>{
      let unspent = [];
      let addrsh = electrum_addrsh(sh);
      let metas = await this.node.getMetaByAddrSH({addrsh});
      for (const meta of metas){
        let tx = meta.tx;
        for (let i=0; i<tx.outputs.length; i++){
          let out = tx.outputs[i];
          if (out.script.sha256().compare(addrsh))
            continue;
          let spend = await this.spend_get(meta, i);
          if (spend.spent)
            continue;
          unspent.push({height: meta.height, tx_hash: meta.tx.rhash(),
            tx_pos: i, value: out.value});
        }
      }
      return unspent;
    });
    ws_rpc.method('blockchain.block.header', async([height])=>{
      let block = await this.chain.getEntryByHeight(height);
      if (!block)
        return {error: 'not found', code: -5};
      return block.toRaw().toString('hex');
    });
    ws_rpc.method('blockchain.transaction.get', async([tx_hash, verbose])=>{
      let txid = Buffer.from(tx_hash, 'hex').reverse();
      let meta = await this.node.getMeta(txid);
      if (!meta)
        return {error: 'not found', code: -5};
      let tx = meta.tx;
      if (!verbose)
        return tx.toRaw().toString('hex');
      let block = meta.height>0
        ? await this.chain.getEntryByHeight(meta.height)
        : null;
      let vin = tx.inputs.map(input=>{
        if (tx.isCoinbase())
          return {coinbase: input.script};
        return {
          txid: revHex(input.prevout.hash),
          vout: input.prevout.index,
        };
      });
      let lif_kv = await this.node.lif_kv_tx_get(tx.hash());
      let vout = [];
      for (let [n, out] of OF (tx.outputs)){
        n = +n;
        let addr = out.getAddress();
        let addrStr = addr ? addr.toString(this.network) : undefined;
        let vo = vout[n] = {
          value: out.value/1e8,
          n,
          scriptPubKey: {
            hex: out.script,
            address: addrStr,
            addresses: addrStr ? [addrStr] : [],
          },
        };
        if (lif_kv?.[n])
          vo.lif_kv = lif_kv[n];
        vo.spent = (await this.spend_get(meta, n)).spent;
      }
      return {
        txid: tx.rhash(),
        vin,
        vout,
        blocktime: block ? block.time : undefined,
        time: block ? block.time : undefined,
        blockhash: block ? block.rhash() : undefined,
        confirmations: block ? this.chain.tip.height-block.height+1 : 0,
      };
    });
    ws_rpc.method('blockchain.transaction.broadcast', async([raw_tx])=>{
      const tx = TX.fromRaw(Buffer.from(raw_tx, 'hex'));
      await this.node.sendTX(tx);
      return tx.rhash();
    });
    ws_rpc.method('blockchain.lif_kv.get', async([key])=>{
      let kv = await this.node.lif_kv_get(key);
      if (!kv)
        return {error: 'not found', code: -5};
      return kv;
    });
    ws_rpc.method('blockchain.estimatefee', async([nblocks])=>{
      return this.network.feeRate/100_000_000;
    });
  }

  async spend_get(meta, nout){
    let tx = meta.tx;
    let out = tx.outputs[nout];
    if (out.script.isUnspendable())
      return {spent: false, unspendable: true};
    if (meta.block){
      let coin = await this.node.chain.getCoin(tx.hash(), nout);
      if (!coin){
        // TODO: add indexing for spent output to locate spending tx:vin
        return {spent: true, txid: '', vin: 0,
          status: {confirmed: true, block_height: 0, block_hash: '',
          block_time: 0}};
      }
    }
    let spent = await this.mempool.isSpent(tx.hash(), nout);
    if (spent)
      return {spent: true, status: {confirmed: false}, txid: tx.rhash()};
    return {spent: false};
  }
  async lookup_spend_tx(hash, i){}
  async blockstream_tx_outspends(meta){
    let tx = meta.tx;
    let spends = [];
    for (let i=0; i<tx.outputs.length; i++)
      spends.push(this.spend_get(meta, i));
    return spends;
  }
  async blockstream_blocks(opt={}){
    let height = this.chain.height;
    let from = opt.from==null ? this.chain.height : opt.from;
    let limit = opt.limit||10;
    let entries = [];
    for (let i=from, j=0; i>=0 && j<limit; i--, j++){
      let entry = await this.chain.getEntryByHeight(i);
      let block = await this.chain.getBlock(entry.hash);
      let _entry = blockstream_block_header(entry, block);
      entries.push(_entry);
    }
    return entries;
  }
  async blockstream_tx(tx){
    let meta = await this.node.getMeta(tx.hash());
    let entry = meta.height>=0 ?
      await this.chain.getEntryByHeight(meta.height) : null;
    let block = entry && await this.chain.getBlock(entry.hash);
    let view = await this.node.getMetaView(meta);
    let lif_kv = await this.node.lif_kv_tx_get(tx.hash());
    return blockstream_tx(meta, view, block, entry, lif_kv);
  }
  async lif_kv_metas_sum(metas, addrsh){
    let result = {confirmed: [], unconfirmed: []};
    for (const meta of metas){
      let tx = meta.tx;
      let to = meta.block ? result.confirmed : result.unconfirmed;
      let tx_kv = await this.node.lif_kv_tx_get(tx.hash());
      if (!tx_kv)
        continue;
      for (let i=0; i<tx.outputs.length; i++){
        let out = tx.outputs[i];
        if (out.script.sha256().compare(addrsh))
          continue;
        let kvs = tx_kv[i];
        if (!kvs)
          continue;
        for (let kv of kvs)
          to.push({tx: tx.rhash(), vout: i, ...kv});
      }
    }
    return result.confirmed.length || result.unconfirmed.length ? result : null;
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
function enforce(value, msg){
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
    ws.send_json = function(json, log){
      let s = JSON.stringify(json);
      if (log)
        console.log(`rpc> ${(''+log).trimEnd()}`);
      console.log(`rpc< ${s}`);
      this.send(s);
    };
    ws.send_res = function(res, log){
      let response = {
        jsonrpc: '2.0',
        id: res.id!=null ? res.id : null,
      };
      if (res.error!=null){
        Object.assign(response, res);
        if (response.code==null)
          response.code = -32000;
      } else
        response.result = res.result;
      this.send_json(response, log);
    };
    ws.on('message', async(message)=>{
      let log = message.slice(0, 80);
      let send = res=>ws.send_res(res, log);
      0 && console.log(`Received: ${(''+message).trimEnd()}`);
      let req;
      try {
        req = JSON.parse(message.toString());
      } catch (err){
        return send({error: 'parse error'});
      }
      let fn;
      if (!('jsonrpc' in req))
        return send({error: 'not jsonrpc'});
      if (typeof req.jsonrpc!='string')
        return send({error: 'invalid jsonrpc version'});
      if (!('params' in req))
        return send({error: 'params missing'});
      if (!('method' in req))
        return send({error: 'params missing'});
      if (!(fn=this.methods[req.method]))
        return send({error: 'method missing: '+req.method});
      let ret;
      try {
        ret = await fn(req.params);
      } catch(err){
        crit_err(err);
        console.error('${message} failed: '+err);
        if (req.id!=null)
          send({error: 'failed: '+err});
        return;
      }
      if (req.id==null)
        return;
      if (ret?.error!=null)
        return send({...ret, id: req.id});
      ws.send_json({result: ret, id: req.id}, log);
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

function blockstream_block_header(entry, block){
  return {
    id: entry.rhash(),
    height: entry.height,
    version: entry.version,
    timestamp: entry.time,
    tx_count: block.txs.length,
    size: block.getSize(),
    weight: block.getWeight(),
    merkle_root: revHex(entry.merkleRoot),
    previousblockhash: revHex(entry.prevBlock),
    mediantime: entry.time, // TODO
    nonce: entry.nonce,
    bits: entry.bits,
    difficulty: toDifficulty(entry.bits),
  };
}

let script_types_blockstream = {
  NONSTANDARD: 'nonstandard',
  PUBKEY: 'p2pk',
  PUBKEYHASH: 'p2pkh',
  SCRIPTHASH: 'p2sh',
  MULTISIG: 'p2ms',
  NULLDATA: 'op_return',
  WITNESSMALFORMED: 'witness_malformed',
  WITNESSSCRIPTHASH: 'v0_p2wsh',
  WITNESSPUBKEYHASH: 'v0_p2wpkh',
  // TAPROOT: 'v1_p2tr' not yet supported
};

function blockstream_output(output){
  let addr = output.getAddress();
  return {
    value: output.value,
    scriptpubkey: output.script,
    scriptpubkey_asm: output.script.toASM(),
    scriptpubkey_type: script_types_blockstream[
      Script.typesByVal[output.script.getType()]],
    scriptpubkey_address: addr ? addr.toString() : undefined,
  };
}
function blockstream_tx_vout(tx){
  return tx.outputs.map((output, n)=>blockstream_output(output));
}

function blockstream_tx_vin(meta, view){
  let tx = meta.tx;
  return tx.inputs.map((input, idx)=>{
    let coin = view.getCoinFor(input);
    let prev = coin ? blockstream_output(coin) : undefined;
    return {
      sequence: input.sequence,
      witness: tx.hasWitness() ? [input.witness.toString()] : [],
      scriptsig: input.script,
      scriptsig_asm: input.script.toASM(),
      is_coinbase: tx.isCoinbase(),
      prevout: prev,
      txid: revHex(input.prevout.hash),
      vout: input.prevout.index,
    };
  });
}

function blockstream_block_status(block, entry){
  return {
    confirmed: true,
    block_height: entry.height,
    block_hash: block.rhash(),
    block_time: block.time,
  };
}

function blockstream_tx(meta, view, block, entry, lif_kv){
  let tx = meta.tx;
  let res = {
    txid: tx.rhash(),
    version: tx.version,
    locktime: tx.locktime,
    size: tx.getSize(),
    weight: tx.getWeight(),
    fee: tx.getFee(view),
    vin: blockstream_tx_vin(meta, view),
    vout: blockstream_tx_vout(tx),
    status: block ? blockstream_block_status(block, entry) : {confirmed: false},
  };
  if (lif_kv){
    for (let [vout, kv] of OF(lif_kv))
      res.vout[vout].lif_kv = kv;
  }
  return res;
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
