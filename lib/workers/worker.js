/*!
 * worker.js - worker thread/process for bcoin
 * Copyright (c) 2014-2015, Fedor Indutny (MIT License)
 * Copyright (c) 2014-2017, Christopher Jeffrey (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';
await import('../../browser/node_env.js');
let require, createRequire;
if (process.browser)
  createRequire = globalThis.$lif.boot.createRequire;
else
  ({createRequire} = await /*keep*/ import('module'));
require = createRequire(import.meta.url);

const Master = require('./master');
const server = new Master();

process.title = 'bcoin-worker';

server.listen();
