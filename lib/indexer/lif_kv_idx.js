/*!
 * addrindexer.js - address indexer for bcoin
 * Copyright (c) 2018, the bcoin developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('assert');
const bdb = require('bdb');
const bio = require('bufio');
const layout = require('./layout');
const Address = require('../primitives/address');
const Indexer = require('./indexer');
const lif_kv = require('../primitives/lif_kv');
const {opcodes}= require('../script/common');

/*
 * LifkvIndexer Database Layout:
 *  L[key] -> vals (json)
 */
Object.assign(layout, {
  L: bdb.key('L', ['buffer']), // key -> val
  t: bdb.key('t', ['hash256']), // tx -> vout kv owner map
});

/**
 * lif_kv_idx
 * @alias module:indexer.lif_kv_idx
 * @extends Indexer
 */
class lif_kv_idx extends Indexer {
  /**
   * Create a indexer
   * @constructor
   * @param {Object} options
   */
  constructor(options){
    debugger;
    super('lif_kv', options);
    this.db = bdb.create(this.options);
  }

  db_op = {
    tx_kv_get: async(tx_hash)=>
      buf_to_json(await this.db.get(layout.t.encode(tx_hash))),
    tx_kv_put: async(tx_hash, vout)=>
      await this.db.put(
        layout.t.encode(tx_hash), json_to_buf(vout)),
    kv_get: async(key)=>
      buf_to_json(await this.db.get(
        layout.L.encode(Buffer.from(key, 'binary')))),
    kv_put: async(tx_hash, key, val)=>
      await this.db.put(
        layout.L.encode(Buffer.from(key, 'binary')),
        json_to_buf(val)),
    kv_del: async(tx_hash, key)=>
      await this.db.del(layout.L.encode(key)),
  };
  /**
   * Index transactions by lif key-val.
   * @private
   * @param {BlockMeta} meta
   * @param {Block} block
   * @param {CoinView} view
   */
  async indexBlock(meta, block, view){
    for (let txi=0; txi<block.txs.length; txi++){
      const tx = block.txs[txi];
      await lif_kv.idx_tx_add(tx, this.db_op);
    }
  }

  /**
   * Remove addresses from index.
   * @private
   * @param {BlockMeta} meta
   * @param {Block} block
   * @param {CoinView} view
   */
  async unindexBlock(meta, block, view){
    for (let txi=block.tsx.length-1; txi>=0; txi--){
      const tx = block.txs[txi];
      await lif_kv.idx_tx_rm(tx, this.db_op);
    }
  }

  async get(key){
    return await this.db_op.kv_get(key);
  }
  async get_vals(key){
    // XXX - add tx_hash
    let val = await this.db_op.kv_get(key);
    if (!val)
      return;
    return {tx: '00000123456789', vout: 0, val};
  }
  async tx_get(tx_hash){
    return await this.db_op.tx_kv_get(tx_hash);
  }
}

function buf_to_json(buf){
  if (!buf)
    return;
  let s = buf.toString('utf8');
  try {
    return JSON.parse(s);
  } catch(e){
    this.logger.warning(`invalid json in buf ${s}`);
    return;
  }
}

function json_to_buf(json){
  return Buffer.from(JSON.stringify(json), 'utf8');
}

module.exports = lif_kv_idx;
