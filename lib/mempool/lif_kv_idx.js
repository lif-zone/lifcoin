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
const {revHex} = require('../utils/util');

/**
 * Lif KV Indexer
 * @ignore
 */
class lif_kv_idx {
  /**
   * Create Lif KV index.
   * @constructor
   */
  constructor(network, options){
    // Map of key->vals.
    this.kv = {};
    this.tx_kv = {};
    this.lif_kv_idx_chain = options.lif_kv_idx;
  }

  reset(){
    this.kv = {};
    this.tx_kv = {};
  }

  _get(key){
    return this.kv[key] && Object.values(this.kv[key]);
  }
  get(key){
    return this._get(key)?.[0]; // just return the first one in mempool
  }
  tx_get(tx_hash){
    return this.tx_kv[revHex(tx_hash)];
  }

  db_op = {
    tx_kv_get: async(tx_hash)=>{
      let kv = this.tx_kv[revHex(tx_hash)];
      if (kv)
        return kv;
      return await this.lif_kv_idx_chain.tx_get(tx_hash);
    },
    tx_kv_put: async(tx_hash, tx_kv)=>{
      this.tx_kv[revHex(tx_hash)] = tx_kv;
    },
    kv_exists: async(key)=>{
      return !!await this.lif_kv_idx_chain._get(key);
    },
    kv_put: async(tx_hash, vout, key, val)=>{
      let kv = this.kv[key] ||= {};
      kv[revHex(tx_hash)] = {tx: revHex(tx_hash), vout, val};
    },
    kv_del: async(tx_hash, vout, key)=>{
      delete this.kv[key][revHex(tx_hash)];
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
