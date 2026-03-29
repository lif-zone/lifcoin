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
const {lif_kv_parse, lif_kv_select}= require('../primitives/lif_kv');

/*
 * LifkvIndexer Database Layout:
 *  L[key] -> vals (json)
 */
Object.assign(layout, {
  L: bdb.key('L', ['buffer']),
});

/**
 * LifKvIndexer
 * @alias module:indexer.LifKvIndexer
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

  /**
   * Index transactions by lif key-val.
   * @private
   * @param {BlockMeta} meta
   * @param {Block} block
   * @param {CoinView} view
   */
  async indexBlock(meta, block, view){
    const height = meta.height;
    for (let i = 0; i < block.txs.length; i++){
      const tx = block.txs[i];
      for (const output of this.outputs){
        let kv;
        if (!(kv = lif_kv_parse(output.script)))
          continue;
        let vals = await this.get_lif_kv_vals(kv.key)||{};
        let pos = ''+height+' '+i;
        vals[pos] = kv.val;
        let _raw = Buffer.from(JSON.stringify(vals), 'utf8');
        await this.put(layout.L.encode(kv.key), _raw);
      }
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
    const height = meta.height;
    for (let i = 0; i < block.txs.length; i++){
      const tx = block.txs[i];
      for (let i=0; i<tx.outputs.length; i++){
        let output = tx.outputs[i];
        let kv;
        if (!(kv = lif_kv_parse(output.script)))
          continue;
        let vals = await this.lif_kv_get_vals(kv.key);
        if (!vals)
          continue;
        let pos = ''+height+' '+i;
        delete vals[pos];
        if (!Object.entries(kv.val).length){
          await this.del(layout.L.encode(kv.key), _raw);
          continue;
        }
        let _raw = Buffer.from(JSON.stringify(vals), 'utf8');
        await this.put(layout.L.encode(kv.key), _raw);
      }
    }
  }

  async lif_kv_get_vals(key){
    let raw = await this.get(layout.L.encode(Buffer.from(key, 'ascii')));
    if (!raw)
      return;
    let vals, _vals = raw.toString('utf8');
    try {
      vals = JSON.parse(_vals);
    } catch(e){
     this.logger.warning(`invalid json in db ${key} val ${_vals}`);
     return;
    }
    return vals;
  }
  async lif_kv_get(key){
    let vals = await this.lif_kv_get_vals(key);
    return lif_kv_select(vals);
  }
}

module.exports = lif_kv_idx;
