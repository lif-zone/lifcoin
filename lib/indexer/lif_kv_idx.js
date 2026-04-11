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
const {revHex} = require('../utils/util');

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
    super('lif_kv', options);
    this.db = bdb.create(this.options);
  }

  db_op = {
    tx_kv_get: async(tx_hash)=>{
      return buf_to_json(await this.db.get(layout.t.encode(tx_hash)));
    },
    tx_kv_put: async(tx_hash, tx_kv)=>{
      return await this.db.put(
        layout.t.encode(tx_hash), json_to_buf(tx_kv));
    },
    kv_exists: async(key)=>{
      return !!await this.get(key);
    },
    kv_put: async(tx_hash, vout, key, val)=>{
      return await this.db.put(
        layout.L.encode(Buffer.from(key, 'binary')),
        json_to_buf({tx: revHex(tx_hash), vout, val}));
    },
    kv_del: async(tx_hash, vout, key)=>{
      return await this.db.del(layout.L.encode(key));
    },
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
    return buf_to_json(await this.db.get(
      layout.L.encode(Buffer.from(key, 'binary'))));
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
