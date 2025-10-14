#!/usr/bin/env node
import server from '../../lif-os/lif-kernel/server_lib.js';
let map = {
  '/lif-coin': '../',
  '/lif-os': '../../lif-os',
  '/lif-basic': '../../lif-os/lif-basic',
  '/lif-kernel': '../../lif-os/lif-kernel',
  '/index.html': './index.html',
  '/favicon.ico': '../../lif-os/lif-kernel/favicon.ico',
};
server({map, root: import.meta.dirname});
