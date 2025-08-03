// hash256lif.js: LIF PoW hash function
'use strict';
const sha256 = require('./sha256');
const sha256lif = require('./sha256lif');

const hash256lif = {
  digest: function(data){
    return sha256lif.digest(sha256.digest(data));
  },
};

module.exports = hash256lif;
