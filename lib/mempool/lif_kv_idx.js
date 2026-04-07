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
const util = require('../utils/util');

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
    this.tx_kv = {};
  }

  reset(){
    this.kv = {};
    this.tx_kv = {};
  }

  get_vals(key){
    return this.kv[key];
  }
  get(key){
    let vals = this.kv[key];
    if (!vals)
      return;
    return Object.values(vals)[0]; // just return the first one
  }

  db_op = {
    tx_kv_get: async(tx_hash)=>{
      let kv = this.tx_kv[util.revHex(tx_hash)];
      if (kv)
        return kv;
      // XXX await this.db.get(layout.t.encode(tx_hash)),
    },
    tx_kv_put: async(tx_hash, vout)=>{
      this.tx_kv[util.revHex(tx_hash)] = vout;
    },
    kv_get: async(key)=>{
      let vals = this.kv[key];
      if (vals)
        return;
      // XXX !!await this.lif_kv_get(kv.key, 'buffer');
    },
    kv_put: async(tx_hash, key, val)=>{
      let kv = this.kv[key] ||= {};
      kv[util.revHex(tx_hash)] = val;
    },
    kv_del: async(tx_hash, key)=>{
      delete this.kv[key][util.revHex(tx_hash)];
      if (!Object.entries(this.kv[key]).length)
        delete this.kv[key];
    }
  };

  async add(tx){
    await lif_kv.idx_tx_add(tx, this.db_op);
  }

  async rm(tx){
    await lif_kv.idx_tx_rm(tx, this.db_op);
  }
}

/*
 * Expose
 */

module.exports = lif_kv_idx;
