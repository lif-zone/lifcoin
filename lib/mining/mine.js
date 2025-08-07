/*!
 * mine.js - mining function for bcoin
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const consensus = require('../protocol/consensus');

/**
 * Hash until the nonce overflows.
 * @alias module:mining.mine
 * @param {Buffer} data
 * @param {Buffer} target - Big endian.
 * @param {Number} min
 * @param {Number} max
 * @param {String} pow_name
 * @returns {Number} Nonce or -1.
 */

function mine(data, target, min, max, pow_net_type){
  const pow_hash256 = consensus.pow_by_net_type(pow_net_type);
  // The heart and soul of the miner: match the target.
  for (let nonce = min; nonce<=max; nonce++){
    // Update the raw buffer.
    data.writeUInt32LE(nonce, 76, true);
    // Hash and test against the next target.
    if (rcmp(pow_hash256.digest(data), target) <= 0)
      return nonce;
  }
  return -1;
}

/**
 * "Reverse" comparison so we don't have
 * to waste time reversing the block hash.
 * @ignore
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {Number}
 */

function rcmp(a, b) {
  assert(a.length === b.length);
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] < b[i])
      return -1;
    if (a[i] > b[i])
      return 1;
  }
  return 0;
}

/*
 * Expose
 */

module.exports = mine;
module.exports.rcmp = rcmp;
