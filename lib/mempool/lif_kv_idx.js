/*!
 * mempool.js - mempool for bcoin
 * Copyright (c) 2018-2019, the bcoin developers (MIT License).
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const {BufferMap} = require('buffer-map');
const TXMeta = require('../primitives/txmeta');
const lif_kv = require('../primitives/lif_kv');

/**
 * Lif KV Indexer
 * @ignore
 */
class lif_kv_idx {
  /**
   * Create Lif KV index.
   * @constructor
   */
  constructor(options){
    // Map of key->vals.
    this.kv = {};
  }

  reset(){
    this.kv = {};
  }

  get_vals(key){
    return this.kv[key];
  }
  get(key){
    let vals = this.kv[key];
    return lif_kv.lif_kv_select(vals);
  }

  add(tx){
    for (let i=0; i<tx.outputs.length; i++){
      let output = tx.outputs[i];
      let kv = lif_kv.lif_kv_parse(output.script);
      if (!kv)
        continue;
      let k = this.kv[kv.key] ||= {};
      let txid = k[tx.rhash()] ||= {};
      txid[i] = kv.val;
    }
  }

  rm(tx){
    let vals;
    for (let i=0; i<tx.outputs.length; i++){
      let output = tx.outputs[i];
      let kv = lif_kv.lif_kv_parse(output.script);
      if (!kv)
        continue;
      delete this.kv[kv.key]?.[tx.rhash()];
      if (!Object.entries(this.kv).length)
        delete this.kv[kv.key];
    }
  }
}

/*
 * Expose
 */

module.exports = lif_kv_idx;
